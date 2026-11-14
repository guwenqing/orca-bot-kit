// `obk --help` names every command a bot does not get by default (#753).
//
// The help has a statement on the default permission set: every bot is
// allowed the kit's commands by default, except some, which keep the user's
// yes. It must name each command of `KEPT_BACK` (src/commands.js), the one
// list the kit keeps back, and no command of `DEFAULT_COMMANDS` as an
// exception. The lists are read from the module, not copied here, so the help
// and the list cannot differ again.
//
// The statement is found by its meaning, not its exact words: it starts at the
// sentence that says the commands are allowed by default, and it ends at the
// first sentence from there that says the user's yes. The help wraps its text,
// so line breaks and runs of spaces are collapsed before any match. The order
// of the names is not pinned.
//
// A command counts as named only as its full name: "obk permission" alone
// names none of the three permission commands. Names are matched longest
// first, and each match is taken out before the shorter ones, so "temp
// retire" never counts as "retire", and "unpause" never counts as "pause".
// A default command whose name is also a common English word ("up", "usage",
// "health") counts only in the form "obk <name>".

import assert from 'node:assert/strict';
import test from 'node:test';

import * as commands from '../src/commands.js';
import { createSandbox } from './helpers/cli.js';

/** The two lists, each checked for its shape first. */
function lists() {
  const { DEFAULT_COMMANDS, KEPT_BACK } = commands;
  assert.ok(Array.isArray(DEFAULT_COMMANDS) && DEFAULT_COMMANDS.length > 0, `src/commands.js should export DEFAULT_COMMANDS, a non-empty array, got: ${JSON.stringify(DEFAULT_COMMANDS)}`);
  assert.ok(Array.isArray(KEPT_BACK) && KEPT_BACK.length > 0, `src/commands.js should export KEPT_BACK, a non-empty array, got: ${JSON.stringify(KEPT_BACK)}`);
  return { DEFAULT_COMMANDS, KEPT_BACK };
}

const collapse = (text) => text.replace(/\s+/g, ' ').trim();

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Names that are also plain English words count only after "obk ". */
const NEEDS_OBK = new Set(['up', 'usage', 'health']);

/** The pattern for one command name, as a whole name, not part of a word. */
function namePattern(name) {
  const words = name.split(' ').map(escape).join('\\s+');
  const prefix = NEEDS_OBK.has(name) ? 'obk\\s+' : '';
  return new RegExp(`(?<![\\w-])${prefix}${words}(?![\\w-])`, 'gi');
}

/**
 * Every command name of `known` that `text` names, longest name first; each
 * match is taken out of the text, so a shorter name inside it does not count.
 */
function namedIn(text, known) {
  let rest = text;
  const found = new Set();
  const longestFirst = [...new Set(known)].sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);
  for (const name of longestFirst) {
    const pattern = namePattern(name);
    if (pattern.test(rest)) {
      found.add(name);
      rest = rest.replace(namePattern(name), ' \u0000 ');
    }
  }
  return found;
}

/** The help text, from a clean run of `obk --help`. */
async function help(t) {
  const box = await createSandbox(t);
  const result = await box.run(['--help']);
  assert.equal(result.code, 0, `obk --help should exit 0, got ${result.code}; stderr: ${result.stderr}`);
  assert.equal(result.stderr, '', 'obk --help should print nothing on stderr');
  return result.stdout;
}

/**
 * The statement on the default set: from the sentence that says the commands
 * are allowed by default, to the first sentence from there that says the
 * user's yes. Returns the statement, collapsed, and its first sentence.
 */
function defaultSetStatement(stdout) {
  const sentences = collapse(stdout).split(/(?<=[.!?])\s+/);
  const start = sentences.findIndex((sentence) => /\ballowed\b/i.test(sentence) && /\bby default\b/i.test(sentence));
  assert.ok(start >= 0, `the help should say which commands every bot is allowed by default, got:\n${stdout}`);
  const offset = sentences.slice(start).findIndex((sentence) => /\byes\b/i.test(sentence));
  assert.ok(offset >= 0, `the statement on the default set should say which commands keep the user's yes, got: ${sentences.slice(start).join(' ')}`);
  assert.ok(offset <= 1, `the statement on the default set should name the kept-back commands within two sentences, got: ${sentences.slice(start, start + offset + 1).join(' ')}`);
  return { statement: sentences.slice(start, start + offset + 1).join(' '), first: sentences[start] };
}

test('HK1 the help names each command of KEPT_BACK where it says what every bot is allowed by default', async (t) => {
  const { DEFAULT_COMMANDS, KEPT_BACK } = lists();
  const { statement } = defaultSetStatement(await help(t));

  const named = namedIn(statement, [...KEPT_BACK, ...DEFAULT_COMMANDS]);
  const missing = KEPT_BACK.filter((name) => !named.has(name));
  assert.deepEqual(missing, [], `the statement on the default set should name every kept-back command by its full name; it leaves out ${missing.map((name) => `"${name}"`).join(', ')}. Statement: "${statement}"`);
});

test('HK2 the help names no command of DEFAULT_COMMANDS as kept back', async (t) => {
  const { DEFAULT_COMMANDS, KEPT_BACK } = lists();
  const { statement } = defaultSetStatement(await help(t));

  const named = namedIn(statement, [...KEPT_BACK, ...DEFAULT_COMMANDS]);
  const wrong = DEFAULT_COMMANDS.filter((name) => named.has(name));
  assert.deepEqual(wrong, [], `the statement on the default set names default commands as kept back: ${wrong.map((name) => `"${name}"`).join(', ')}. Statement: "${statement}"`);
});

test('HK3 the paragraph that holds the statement keeps each line within 80 characters', async (t) => {
  const stdout = await help(t);
  const { first } = defaultSetStatement(stdout);

  // The statement's paragraph: the block between blank lines whose text
  // holds the statement's first sentence.
  const paragraph = stdout.split(/\n[ \t]*\n/).find((block) => collapse(block).includes(first));
  assert.ok(paragraph !== undefined, `the statement should sit inside one paragraph of the help, got:\n${stdout}`);
  const long = paragraph.split('\n').filter((line) => line.length > 80);
  assert.deepEqual(long, [], 'each line of the paragraph on the default set should be 80 characters or fewer');
});

test('HK4 the name matcher counts only whole command names (premise of HK1 and HK2)', () => {
  const known = ['retire', 'temp retire', 'pause', 'unpause', 'session add', 'session answer', 'up', 'permission allow'];
  assert.deepEqual([...namedIn('obk temp retire and obk unpause', known)].sort(), ['temp retire', 'unpause']);
  assert.deepEqual([...namedIn('obk retire, pause and session add', known)].sort(), ['pause', 'retire', 'session add']);
  assert.deepEqual([...namedIn('obk permission, which keep it up', known)], []);
  assert.deepEqual([...namedIn('obk up and obk permission\n  allow', known)].sort(), ['permission allow', 'up']);
});
