// Every Codex session a system test makes starts trusted at launch, so Codex
// writes nothing about the test's throwaway folder into the user's own
// ~/.codex/config.toml (#240, option (c), proved live by
// test/system/codex-trust-override.test.js).
//
// This reads the system tests as text; it runs none of them. For each
// `'session', 'add'` call it works out the session's harness: the call's own
// `--harness` if it has one, and otherwise that of the `'bot', 'create'` call in
// the same file that made the bot it names. A harness written as a literal is
// that harness; one written as `NAME.harness`, for an object `const NAME = { …
// harness: '…' … }` in the file, is that object's; bot-father is Claude (the
// kit's `init --harness claude`); anything else, such as a loop's
// `bot.harness`, could be Codex. A session that is or could be Codex has to pass
// `codexTrustArgs(` in the same call.
//
// Two files are left out on purpose: codex-first-run-screens.test.js, whose
// point is to meet and answer Codex's first-run screens (its writes are named by
// the runner as known, #240), and codex-trust-override.test.js, which builds the
// same arguments itself and is the proof of them.
//
// Two forms of it are each taken for the calls named below only, and named
// anywhere else: `codexTrustArgs(…, { hooks: false })`, the folder trusted and
// the hooks review not bypassed, for session-identity's `untrusted-codex`, the
// case that wants the kit's hook not to run (#240), for temp-of-temp's
// Codex session, whose hooks review its maker answers (#464), and for
// session-first-run's `CODEX_BOT`, whose real hooks review `obk session
// trust-hooks` answers (#506); and
// `codexTrustArgs(…, { sleep: true })`, Codex's sleep tool left on, for
// codex-sleep's sleep-codex, the check that a real bot with the tool still gets
// its mail (#432).
//
// A `'temp', 'make'` call is read too (#464), by its `--name`, when its own
// `--harness` is or could be Codex. One that names no harness takes its maker's,
// which the call does not show, and is not read.
//
// Comments are taken out before anything is read, so a call left in a comment
// is not a call.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot, snapshot } from './helpers/cli.js';

const systemTestsDir = path.join(repoRoot, 'test', 'system');

/** The system tests this check leaves out, and why is in the header. */
const LEFT_OUT = new Set(['codex-first-run-screens.test.js', 'codex-trust-override.test.js']);

/**
 * The forms of `codexTrustArgs` each taken for the calls named only, by file
 * and bot for a session add, by file and name for a temp make: `hooks: false`
 * for session-identity's case of a conversation that ran before the hooks file
 * was trusted, which wants the kit's hook not to run (#240), for
 * temp-of-temp's Codex session, whose maker answers its hooks review (#464),
 * and for session-first-run's Codex bot, whose hooks review `obk session
 * trust-hooks` answers (#506); `sleep: true` for codex-sleep's bot that keeps Codex's sleep tool (#432).
 */
const ONE_CALL_FORMS = [
  { form: 'hooks: false', words: /\bhooks:\s*false\b/, file: 'session-identity.test.js', bot: "'untrusted-codex'" },
  { form: 'hooks: false', words: /\bhooks:\s*false\b/, file: 'temp-of-temp.test.js', make: 'REVIEW' },
  { form: 'hooks: false', words: /\bhooks:\s*false\b/, file: 'session-first-run.test.js', bot: 'CODEX_BOT' },
  { form: 'sleep: true', words: /\bsleep:\s*true\b/, file: 'codex-sleep.test.js', bot: 'SLEEPER.name' },
];

/** The source with its comments taken out, strings and template literals kept as they are. */
function withoutComments(source) {
  let out = '';
  let at = 0;
  let quote = null;
  while (at < source.length) {
    const here = source[at];
    const next = source[at + 1];
    if (quote !== null) {
      out += here;
      if (here === '\\') {
        out += next ?? '';
        at += 2;
        continue;
      }
      if (here === quote) quote = null;
      at += 1;
      continue;
    }
    if (here === '/' && next === '/') {
      while (at < source.length && source[at] !== '\n') at += 1;
      continue;
    }
    if (here === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2);
      at = end < 0 ? source.length : end + 2;
      continue;
    }
    if (here === '\'' || here === '"' || here === '`') quote = here;
    out += here;
    at += 1;
  }
  return out;
}

/**
 * The top-level elements of the array literal whose `[` is at `from`, as their
 * source text, trimmed, and where the literal ends. Strings, template literals
 * and nested brackets are kept whole.
 */
function elementsAt(code, from) {
  const elements = [];
  let depth = 0;
  let quote = null;
  let start = from + 1;
  for (let at = from; at < code.length; at += 1) {
    const here = code[at];
    if (quote !== null) {
      if (here === '\\') at += 1;
      else if (here === quote) quote = null;
      continue;
    }
    if (here === '\'' || here === '"' || here === '`') quote = here;
    else if ('([{'.includes(here)) depth += 1;
    else if (')]}'.includes(here)) {
      depth -= 1;
      if (depth === 0) {
        elements.push(code.slice(start, at).trim());
        return { elements: elements.filter((one) => one !== ''), end: at + 1, text: code.slice(from, at + 1) };
      }
    } else if (here === ',' && depth === 1) {
      elements.push(code.slice(start, at).trim());
      start = at + 1;
    }
  }
  return { elements: elements.filter((one) => one !== ''), end: code.length, text: code.slice(from) };
}

/** Every array literal in the code that starts with the two words, e.g. `'session', 'add'`. */
function callsOf(code, first, second) {
  const found = [];
  const words = new RegExp(`\\[\\s*'${first}',\\s*'${second}'`, 'g');
  for (const match of code.matchAll(words)) found.push(elementsAt(code, match.index));
  return found;
}

/** The element after a flag in a call, or undefined. */
function after(elements, flag) {
  const at = elements.indexOf(`'${flag}'`);
  return at < 0 ? undefined : elements[at + 1];
}

/** What a harness expression says, in this file: 'claude', 'codex', or undefined when it could be either. */
function harnessOf(code, expression) {
  const literal = /^'(claude|codex)'$/.exec(expression ?? '');
  if (literal !== null) return literal[1];
  const field = /^([A-Z_][A-Z0-9_]*)\.harness$/.exec(expression ?? '');
  if (field !== null) {
    const object = new RegExp(`const ${field[1]} = \\{[^}]*?\\bharness: '(claude|codex)'`).exec(code);
    if (object !== null) return object[1];
  }
  return undefined;
}

/**
 * Each Codex session a file makes, or could make, without `codexTrustArgs(`, or
 * with one of its one-call forms where that is not the named call, as
 * sentences. `file` is the file's name, for the named calls.
 */
function untrustedCodexIn(source, file) {
  const code = withoutComments(source);
  const bots = new Map(callsOf(code, 'bot', 'create').map(({ elements }) => [after(elements, '--name'), after(elements, '--harness')]));
  const trouble = [];
  for (const { elements, text } of callsOf(code, 'session', 'add')) {
    const bot = after(elements, '--bot');
    const own = after(elements, '--harness');
    let harness;
    if (own !== undefined) harness = harnessOf(code, own);
    else if (bot === "'bot-father'") harness = 'claude';
    else if (bots.has(bot)) harness = harnessOf(code, bots.get(bot));
    if (harness === 'claude') continue;
    const session = after(elements, '--name');
    if (text.includes('codexTrustArgs(')) {
      trouble.push(...formsAgainst(text, file, 'bot', bot, `a session add for ${bot} ${session}`));
      continue;
    }
    trouble.push(`a session add for ${bot} ${session}, ${harness === 'codex' ? 'a Codex session' : 'which could be a Codex session'}, passes no codexTrustArgs(…)`);
  }
  for (const { elements, text } of callsOf(code, 'temp', 'make')) {
    const own = after(elements, '--harness');
    if (own === undefined || harnessOf(code, own) === 'claude') continue;
    const name = after(elements, '--name');
    if (text.includes('codexTrustArgs(')) {
      trouble.push(...formsAgainst(text, file, 'make', name, `a temp make of ${name}`));
      continue;
    }
    trouble.push(`a temp make of ${name}, ${harnessOf(code, own) === 'codex' ? 'a Codex session' : 'which could be a Codex session'}, passes no codexTrustArgs(…)`);
  }
  return trouble;
}

/**
 * Each one-call form of `codexTrustArgs` a call's `text` uses that names
 * another call, as a sentence: `key` is `bot` for a session add and `make` for
 * a temp make, `who` the call's own for it, and `what` the call, as said.
 */
function formsAgainst(text, file, key, who, what) {
  const trouble = [];
  for (const form of new Set(ONE_CALL_FORMS.map((one) => one.form))) {
    if (!ONE_CALL_FORMS.find((one) => one.form === form).words.test(text)) continue;
    const named = ONE_CALL_FORMS.filter((one) => one.form === form && one[key] !== undefined);
    if (named.some((one) => one.file === file && one[key] === who)) continue;
    const only = named.map((one) => `${one.file}'s ${one[key].replace(/^'(.*)'$/, '$1')}`).join(' or ');
    trouble.push(`${what} passes codexTrustArgs with ${form}, which only ${only === '' ? 'no call of its kind' : only} may`);
  }
  return trouble;
}

// ------------------------------------------------------------- the check's own cases

const CASES = `
const BOT = {
  name: 'x-claude',
  harness: 'claude',
};
const CODEX_BOT = {
  name: 'x-codex',
  harness: 'codex',
};
obkJson(['bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', BOT.harness]);
obkJson(['bot', 'create', '--bots', bots, '--name', CODEX_BOT.name, '--harness', CODEX_BOT.harness]);
obkJson(['bot', 'create', '--bots', bots, '--name', 'lit-codex', '--harness', 'codex']);
for (const bot of BOTS) obkJson(['bot', 'create', '--bots', bots, '--name', bot.name, '--harness', bot.harness]);
obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily', \`--prompt=\${p}\`]);
obkJson(['session', 'add', '--bots', bots, '--bot', 'bot-father', '--name', 'grooming']);
obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'sender', '--harness', 'codex']);
obkJson(['session', 'add', '--bots', bots, '--bot', CODEX_BOT.name, '--name', 'daily', \`--prompt=\${[a, b].join(' ')}\`]);
obkJson(['session', 'add', '--bots', bots, '--bot', 'lit-codex', '--name', 'daily']);
for (const bot of BOTS) obkJson(['session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'daily']);
obkJson(['session', 'add', '--bots', bots, '--bot', CODEX_BOT.name, '--name', 'trusted', ...codexTrustArgs(bots)]);
for (const bot of BOTS) obkJson(['session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'looped', ...(bot.harness === 'codex' ? codexTrustArgs(bots) : [])]);
// obkJson(['session', 'add', '--bots', bots, '--bot', CODEX_BOT.name, '--name', 'commented']);
`;

test('the check names each Codex session made without the trust args, and passes the Claude ones and the trusted ones', () => {
  assert.deepEqual(untrustedCodexIn(CASES, 'cases.test.js'), [
    'a session add for BOT.name \'sender\', a Codex session, passes no codexTrustArgs(…)',
    'a session add for CODEX_BOT.name \'daily\', a Codex session, passes no codexTrustArgs(…)',
    'a session add for \'lit-codex\' \'daily\', a Codex session, passes no codexTrustArgs(…)',
    'a session add for bot.name \'daily\', which could be a Codex session, passes no codexTrustArgs(…)',
  ]);
});

test('hooks: false is taken for the one call named for it, and named anywhere else', () => {
  const untrusted = "obkJson(['bot', 'create', '--bots', bots, '--name', 'untrusted-codex', '--harness', 'codex']);\n"
    + "obkJson(['session', 'add', '--bots', bots, '--bot', 'untrusted-codex', '--name', 'daily', ...codexTrustArgs(bots, { hooks: false })]);\n";
  assert.deepEqual(untrustedCodexIn(untrusted, 'session-identity.test.js'), [], 'the named call, in its file');
  assert.deepEqual(untrustedCodexIn(untrusted, 'other.test.js'), [
    'a session add for \'untrusted-codex\' \'daily\' passes codexTrustArgs with hooks: false, which only session-identity.test.js\'s untrusted-codex or session-first-run.test.js\'s CODEX_BOT may',
  ], 'the same call in another file');
  const otherBot = untrusted.replaceAll('untrusted-codex', 'some-codex');
  assert.deepEqual(untrustedCodexIn(otherBot, 'session-identity.test.js'), [
    'a session add for \'some-codex\' \'daily\' passes codexTrustArgs with hooks: false, which only session-identity.test.js\'s untrusted-codex or session-first-run.test.js\'s CODEX_BOT may',
  ], 'another bot in that file');
});

test('a temp make on Codex is read by its name: hooks: false is taken for temp-of-temp\'s REVIEW, and named anywhere else (#464)', () => {
  const makes = "obkJson(['temp', 'make', '--bots', bots, '--name', DEV, '--prompt', TASK], inTab(lead));\n"
    + "obkJson(['temp', 'make', '--bots', bots, '--name', 'drafter', '--harness', 'claude']);\n"
    + "obkJson(['temp', 'make', '--bots', bots, '--name', 'bare', '--harness', 'codex']);\n"
    + "obkJson([\n  'temp', 'make', '--bots', bots, '--name', REVIEW, '--harness', 'codex',\n  ...codexTrustArgs(bots, { hooks: false }),\n], inTab(dev));\n";
  assert.deepEqual(untrustedCodexIn(makes, 'temp-of-temp.test.js'), [
    'a temp make of \'bare\', a Codex session, passes no codexTrustArgs(…)',
  ], 'REVIEW in its file is taken; one with no harness or on Claude Code is not read; one on Codex with none is named');
  assert.deepEqual(untrustedCodexIn(makes, 'other.test.js'), [
    'a temp make of \'bare\', a Codex session, passes no codexTrustArgs(…)',
    'a temp make of REVIEW passes codexTrustArgs with hooks: false, which only temp-of-temp.test.js\'s REVIEW may',
  ], 'the same calls in another file');
  const added = "obkJson(['bot', 'create', '--bots', bots, '--name', 'untrusted-codex', '--harness', 'codex']);\n"
    + "obkJson(['session', 'add', '--bots', bots, '--bot', 'untrusted-codex', '--name', 'daily', ...codexTrustArgs(bots, { hooks: false })]);\n";
  assert.deepEqual(untrustedCodexIn(added, 'temp-of-temp.test.js'), [
    'a session add for \'untrusted-codex\' \'daily\' passes codexTrustArgs with hooks: false, which only session-identity.test.js\'s untrusted-codex or session-first-run.test.js\'s CODEX_BOT may',
  ], 'temp-of-temp\'s leave covers its temp make, not a session add in it');
});

test('sleep: true is taken for the one call named for it, and named anywhere else', () => {
  const sleeper = "obkJson(['bot', 'create', '--bots', bots, '--name', SLEEPER.name, '--harness', 'codex']);\n"
    + "obkJson(['session', 'add', '--bots', bots, '--bot', SLEEPER.name, '--name', 'daily', ...codexTrustArgs(bots, { sleep: true })]);\n";
  assert.deepEqual(untrustedCodexIn(sleeper, 'codex-sleep.test.js'), [], 'the named call, in its file');
  assert.deepEqual(untrustedCodexIn(sleeper, 'messaging.test.js'), [
    'a session add for SLEEPER.name \'daily\' passes codexTrustArgs with sleep: true, which only codex-sleep.test.js\'s SLEEPER.name may',
  ], 'the same call in another file');
  assert.deepEqual(untrustedCodexIn(sleeper.replaceAll('SLEEPER', 'AWAKE'), 'codex-sleep.test.js'), [
    'a session add for AWAKE.name \'daily\' passes codexTrustArgs with sleep: true, which only codex-sleep.test.js\'s SLEEPER.name may',
  ], 'another bot in that file');
});

test('a session add on Codex: hooks: false is taken for session-first-run\'s CODEX_BOT, and named anywhere else (#506)', () => {
  const firstRun = "const CODEX_BOT = 'first-codex';\nconst CODEX_SESSION = 'daily';\n"
    + "obkJson(['bot', 'create', '--bots', bots, '--name', CODEX_BOT, '--harness', 'codex']);\n"
    + "obkJson([\n  'session', 'add', '--bots', bots, '--bot', CODEX_BOT, '--name', CODEX_SESSION,\n  ...codexTrustArgs(bots, { hooks: false }),\n]);\n";
  assert.deepEqual(untrustedCodexIn(firstRun, 'session-first-run.test.js'), [], 'the named call, in its file');
  assert.deepEqual(untrustedCodexIn(firstRun, 'other.test.js'), [
    'a session add for CODEX_BOT CODEX_SESSION passes codexTrustArgs with hooks: false, which only session-identity.test.js\'s untrusted-codex or session-first-run.test.js\'s CODEX_BOT may',
  ], 'the same call in another file');
  assert.deepEqual(untrustedCodexIn(firstRun.replaceAll('CODEX_BOT', 'OTHER_BOT'), 'session-first-run.test.js'), [
    'a session add for OTHER_BOT CODEX_SESSION passes codexTrustArgs with hooks: false, which only session-identity.test.js\'s untrusted-codex or session-first-run.test.js\'s CODEX_BOT may',
  ], 'another bot in that file');
  const make = "obkJson(['temp', 'make', '--bots', bots, '--name', CODEX_BOT, '--harness', 'codex', ...codexTrustArgs(bots, { hooks: false })]);\n";
  assert.deepEqual(untrustedCodexIn(make, 'session-first-run.test.js'), [
    'a temp make of CODEX_BOT passes codexTrustArgs with hooks: false, which only temp-of-temp.test.js\'s REVIEW may',
  ], 'session-first-run\'s leave covers its session add, not a temp make in it');
});

// ------------------------------------------------------------- the system tests

test('every Codex session a system test makes passes codexTrustArgs, but in the two files left out on purpose', async () => {
  const tree = await snapshot(systemTestsDir);
  const files = Object.keys(tree).filter((rel) => tree[rel].startsWith('file:') && rel.endsWith('.test.js')).sort();
  assert.ok(files.length > 0, 'there should be system tests to check');

  const found = [];
  let sessions = 0;
  for (const rel of files) {
    if (LEFT_OUT.has(path.basename(rel))) continue;
    const source = await readFile(path.join(systemTestsDir, rel), 'utf8');
    sessions += callsOf(withoutComments(source), 'session', 'add').length;
    for (const why of untrustedCodexIn(source, path.basename(rel))) found.push(`test/system/${rel}: ${why}`);
  }
  assert.ok(sessions > 0, 'no session add was found in the system tests, so the check sees nothing');
  assert.deepEqual(found, [], `Codex sessions made without the launch-time trust (#240):\n  ${found.join('\n  ')}`);
});
