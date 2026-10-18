// The permission rules a bot may run with, written into its own Claude
// settings: the kit's default set, and the rules its user said yes to (#344).
//
// A bot in auto mode is stopped by the harness's check for things the kit's own
// rules tell every bot to do: run the kit's commands, read a long message's
// body beside the bots folder, commit. A matching allow rule is settled before
// that check (Claude Code's permissions docs), so the kit gives every bot a
// default set, spelled with its real CLI and bots folder, with nobody asked
// (#527, ADR 0050). A rule beyond it is the user's yes, which
// `permission allow` keeps in bot.yaml's `allow`. The kit's code writes what
// `allow` holds into `.claude/settings.json` in the bot folder, beside its hook
// (ADR 0022). A model editing the file by hand may get the format wrong; code
// does not.
//
// The kit owns only the entries `allow` holds. Any other entry in the file is
// left where it is, and health names it. A rule the user says yes to taking
// back leaves `allow` and the files through `permission disallow` (#360).
//
// A bot on Codex gets the same rules in Codex's own form (#354, ADR 0039): each
// `Bash(<words>:*)` becomes a `prefix_rule` of those words in
// `.codex/rules/obk.rules`, a file the kit owns whole and rewrites from `allow`.

import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { allowRules, botsDir, leadsOutside } from './bot.js';
import { DEFAULT_COMMANDS, NO_LONGER_DEFAULT, REMOVED } from './commands.js';
import { readSettings } from './hooks.js';
import { harnessOf, ownCli, shellWord } from './launch.js';

/** Where Claude Code reads a project's settings, inside the bot home. */
const FILE = '.claude/settings.json';

/** Where Codex reads a trusted project's rules, and the one file of them the kit owns. */
const CODEX_RULES = '.codex/rules';
const CODEX_FILE = `${CODEX_RULES}/obk.rules`;

/**
 * The rules every bot is given (ADR 0050): each of the kit's default commands,
 * and none kept back for the user's yes (ADR 0051), narrowed to this bots folder and
 * spelled as the kit prints them, which is what a bot runs; reading a long
 * message; and committing. `//` is Claude's form for an absolute path.
 */
export function defaultRules(bots, cli = ownCli()) {
  const kit = shellWord(cli);
  const folder = shellWord(bots);
  return [
    ...DEFAULT_COMMANDS.map((command) => `Bash(${kit} ${command} --bots ${folder}:*)`),
    `Read(/${bots}.messages/**)`,
    'Bash(git add:*)',
    'Bash(git commit:*)',
  ];
}

/**
 * Orca's check, which the set held until #564: the kit's rules tell a bot to
 * read its mail with `obk message check`, never with the bare check, which
 * leaves it unread (ADR 0042).
 */
const ORCA_CHECK = 'Bash(orca orchestration check --run:*)';

/**
 * The rules that were defaults once and are not now, that the bot's `allow`
 * holds: those of the commands kept back (#548, #615) or gone from the kit (#555),
 * spelled as `defaultRules` spelled them, and Orca's check (#564). The kit
 * cannot tell its own old entry from a user's yes to the same rule, so it
 * names them and leaves them (ADR 0051, ADR 0050).
 */
export function heldRules(bots, home, bot, cli = ownCli()) {
  const allowed = allowOf(home, bot);
  return [...NO_LONGER_DEFAULT, ...REMOVED].map((command) => `Bash(${shellWord(cli)} ${command} --bots ${shellWord(bots)}:*)`)
    .concat(ORCA_CHECK)
    .filter((rule) => allowed.includes(rule));
}

/** Command wrappers: programs that run the command their arguments name. */
const WRAPPERS = new Set(['env', 'xargs', 'sudo', 'eval', 'exec', 'nohup', 'timeout', 'nice', 'command', 'time', 'watch']);

/**
 * Programs that run whatever their arguments tell them to: shells, interpreters
 * and the wrappers above. With a wildcard after one of them, a rule lets the bot
 * run any command, unless the next word fixes what runs by its absolute path.
 */
const RUNNERS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh',
  'python', 'python2', 'python3', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'osascript',
  'npx', 'pnpx', 'bunx', 'uvx',
  ...WRAPPERS,
]);

const ANY = 'it lets the bot run any command';

/**
 * Why a rule is broad, as the end of a sentence, or undefined for a narrow one
 * (#353). A charter's grants are written as narrow, exact rules only; one that
 * lets the bot run any command, a program with any arguments, or any file on
 * the disk or in the home is the user's to add by hand (ADR 0038).
 */
export function broadness(rule) {
  if (typeof rule !== 'string') return undefined;
  const file = /^(Read|Edit|Write)(?:\((.*)\))?$/s.exec(rule);
  if (file !== null) {
    const spec = file[2] ?? '';
    return spec === '' || /^(\/\/|~\/)[*/]*$/.test(spec) ? `it lets the bot ${file[1].toLowerCase()} any file` : undefined;
  }
  const bash = /^Bash(?:\((.*)\))?$/s.exec(rule);
  if (bash === null) return undefined;
  const { words, odd } = shellWords(bash[1] ?? '');
  if (odd !== undefined) return `it holds ${odd}, which the shell reads specially, so the kit cannot tell what it runs`;
  return commandBroadness(words);
}

/** What a word may hold outside quotes; anything else the shell reads specially. */
const PLAIN = /[A-Za-z0-9\-_./:=@%+,^*]/;

/**
 * A Bash rule's command as the shell words it is, quotes taken off, or the
 * first thing in it the shell reads specially: `{ words }` or `{ odd }`. Only
 * plain words are judged, so an escape, an expansion or a second command can
 * never hide which program runs.
 */
function shellWords(text) {
  const words = [];
  let word;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === ' ' || char === '\t') {
      if (word !== undefined) words.push(word);
      word = undefined;
      continue;
    }
    word ??= '';
    if (char === "'" || char === '"') {
      const end = text.indexOf(char, at + 1);
      if (end === -1) return { odd: `a ${char} that does not close` };
      const inside = text.slice(at + 1, end);
      const special = char === '"' ? /[$`\\]/.exec(inside) : null;
      if (special !== null) return { odd: `the character ${special[0]}` };
      word += inside;
      at = end;
    } else if (char === '\\' && text[at + 1] === "'") {
      // An apostrophe outside quotes, the form shellWord gives one in a path.
      word += "'";
      at += 1;
    } else if (PLAIN.test(char) || (char === '~' && word === '')) {
      word += char;
    } else {
      return { odd: char === '\n' ? 'a newline' : `the character ${char}` };
    }
  }
  if (word !== undefined) words.push(word);
  return { words };
}

/** The shell or interpreter a program name is, with a version on its name or not. */
const runnerOf = (name) => [name, name.replace(/[\d.]+$/, '')].find((one) => RUNNERS.has(one));

/** Why a Bash rule's command, as shell words, is broad, or undefined. */
function commandBroadness(all) {
  // The program is the first word after any shell assignments in front of it.
  let words = all;
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words = words.slice(1);
  if (words.length === 0) return ANY;
  const star = words.findIndex((word) => word.includes('*'));
  if (star === -1) return undefined;

  const program = path.basename(words[0].replace(/:?\*.*$/, ''));
  if (isKit(words[0]) && mayRun(words[1] ?? '')) return runBroadness(words);
  if (runnerOf(program) !== undefined) {
    // Only what runs, fixed by its absolute path, narrows it. A wrapper's
    // program is then judged by itself; an interpreter's script is the end,
    // unless it is the kit, which is judged as the kit.
    const next = (words[1] ?? '').replace(/:\*$/, '');
    const fixed = next.startsWith('/') && !next.includes('*');
    if (fixed && (WRAPPERS.has(program) || isKit(next))) return commandBroadness(words.slice(1));
    if (fixed && runnerOf(path.basename(next)) === undefined) return undefined;
    return `${program} runs whatever its arguments say, so ${ANY}`;
  }

  // Two words at least before the first wildcard: a program and what it does.
  const part = words[star].slice(0, words[star].indexOf('*')).replace(/:$/, '');
  const before = star + (part === '' ? 0 : 1);
  if (before === 0) return ANY;
  if (before < 2) return `it lets the bot run ${words[0].replace(/:?\*.*$/, '')} with any arguments`;
  return undefined;
}

/** Whether a word is the kit's CLI: `obk` by its name, or the path the kit runs as. */
const isKit = (word) => path.basename(word) === 'obk' || word === ownCli();

/**
 * Whether a rule's word can match `run`: Claude's `*` matches any characters,
 * spaces too, so `ru*` matches `run --timeout 1 -- sh`, while `:*` matches
 * only at the end of a word.
 */
function mayRun(word) {
  const star = word.indexOf('*');
  if (star === -1) return word === 'run';
  const before = word.slice(0, star);
  return before.endsWith(':') ? before === 'run:' : 'run'.startsWith(before);
}

/**
 * Why a rule for `obk run`, as shell words, is broad, or undefined (#532). It
 * runs whatever its arguments say, so only a fixed time limit, `--`, and a
 * command after it that is narrow as a rule of its own narrow it.
 */
function runBroadness(words) {
  const [, , ...rest] = words;
  let command;
  if (rest[0] === '--timeout' && /^\d+$/.test(rest[1] ?? '') && rest[2] === '--') command = rest.slice(3);
  if (/^--timeout=\d+$/.test(rest[0] ?? '') && rest[1] === '--') command = rest.slice(2);
  if (words[1] !== 'run' || command === undefined || command.length === 0) {
    return `obk run runs whatever its arguments say, so ${ANY}. A rule for it names the command after --, such as Bash(obk run --timeout 300 -- go test:*)`;
  }
  return commandBroadness(command);
}

/**
 * A program no rule can name, standing for any command: a rule that matches
 * the kit's run of it matches the run of any command (#635). Shell words
 * cannot hold it.
 */
const ANY_COMMAND = '\u0007';

/** A wildcard in a rule, as `globOf` gives it: any text, spaces included. */
const STAR = Symbol('*');

/** A rule's text as a glob: each character itself, and each `*` a wildcard when `wild`. */
const globOf = (text, wild = true) => [...text].map((char) => (wild && char === '*' ? STAR : char));

/*
 * The commands a rule is held against, as a small automaton (#635): each state
 * a list of edges, each a test of one character, or null for an edge that
 * takes none. A part is `(machine, from) => to`.
 */
const text = (word) => (m, from) => [...word].reduce((at, char) => one((c) => c === char)(m, at), from);
const one = (test) => (m, from) => {
  const to = m.state();
  m.edge(from, test, to);
  return to;
};
const many = (test) => (m, from) => {
  const to = m.state();
  m.edge(from, null, to);
  m.edge(to, test, to);
  return to;
};
const seq = (...parts) => (m, from) => parts.reduce((at, part) => part(m, at), from);
const alt = (...parts) => (m, from) => {
  const to = m.state();
  for (const part of parts) m.edge(part(m, from), null, to);
  return to;
};
const maybe = (part) => alt(part, seq());

function automaton(part) {
  const states = [];
  const m = { state: () => states.push([]) - 1, edge: (from, test, to) => states[from].push([test, to]) };
  const start = m.state();
  return { states, start, end: part(m, start) };
}

const notSpace = (c) => c !== ' ' && c !== '\t';
const digit = (c) => c >= '0' && c <= '9';
const anything = () => true;

/** A program that runs whatever its arguments say, by its name or its absolute path, with a version on its name or not. */
const runner = seq(maybe(seq(text('/'), maybe(seq(many(notSpace), text('/'))))), alt(...[...RUNNERS].map(text)), many((c) => digit(c) || c === '.'));

/** A word that is a runner, and nothing more. */
let runnerWord;

/**
 * The kit's run of any command, for the kit as it is spelled now: `obk`, any
 * path to an `obk`, or the CLI the kit runs as, alone or behind a runner;
 * then the run with a time limit; then after `--` any command, or a runner
 * with whatever it is told to run (a first argument that is not a fixed path).
 */
const runsOfAny = new Map();
function runOfAny() {
  const kit = shellWord(ownCli());
  if (!runsOfAny.has(kit)) {
    runsOfAny.set(kit, automaton(seq(
      maybe(seq(runner, text(' '))),
      alt(text('obk'), seq(many(notSpace), text('/obk')), text(kit)),
      text(' run --timeout'), alt(text(' '), text('=')), one(digit), many(digit), text(' -- '),
      alt(seq(text(ANY_COMMAND), many(anything)), seq(runner, text(' '), one((c) => c !== '/'), many(anything))),
    )));
  }
  return runsOfAny.get(kit);
}

/**
 * Whether a glob matches any command the automaton takes: a walk of the two
 * together, where a wildcard takes any character, and every test takes one.
 */
function meets(glob, { states, start, end }) {
  const seen = new Set();
  const todo = [[0, start]];
  while (todo.length > 0) {
    const [at, state] = todo.pop();
    const key = at * states.length + state;
    if (seen.has(key)) continue;
    seen.add(key);
    if (at === glob.length && state === end) return true;
    const here = glob[at];
    if (here === STAR) todo.push([at + 1, state]);
    for (const [test, to] of states[state]) {
      if (test === null || here === STAR) todo.push([at, to]);
      else if (here !== undefined && test(here)) todo.push([at + 1, to]);
    }
  }
  return false;
}

/**
 * Whether a rule, as its first two words and its glob, lets the kit's run run
 * any command (#635). One whose first word can be a runner lets the bot run
 * any command without the kit, unless the kit itself comes next, and is named
 * as any other rule: `Bash`, `Bash(*)`, `Bash(env:*)`.
 */
function runsAnyThroughKit([first = '', second = ''], glob, wild) {
  runnerWord ??= automaton(runner);
  const plain = (word) => word.replace(/:\*$/, '');
  const kitNext = !(wild && second.includes('*')) && isKit(plain(second));
  if (meets(globOf(plain(first), wild), runnerWord) && !kitNext) return false;
  return meets(glob, runOfAny());
}

/**
 * Whether a Claude rule lets the kit's run run any command (#635), matched as
 * Claude Code matches it: `x:*` at the end is `x *`, and any `*` is any text,
 * spaces included. A rule with no wildcard is one exact command.
 */
export function letsRunAnything(rule) {
  const bash = /^Bash(?:\((.*)\))?$/s.exec(rule);
  if (bash === null) return false;
  const spec = bash[1] ?? '*';
  if (!spec.includes('*')) return false;
  const { words, odd } = shellWords(spec);
  const glob = globOf(spec.endsWith(':*') ? `${spec.slice(0, -2)} *` : spec);
  return runsAnyThroughKit(odd === undefined ? words : spec.split(' '), glob, true);
}

/*
 * A Codex rules file, read as far as health reads one (#635): its comments,
 * and calls of the three builtins whose arguments are literals. Anything else
 * is Starlark the kit does not evaluate, and health says it cannot tell.
 */
const BUILTINS = new Set(['prefix_rule', 'host_executable', 'network_rule']);

/** The text with each comment blanked out, so a place in it is the same place in the file. */
function uncommented(source) {
  let out = '';
  let quote;
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];
    if (quote !== undefined) {
      out += char;
      if (char === '\\' && at + 1 < source.length) out += source[++at];
      else if (char === quote || char === '\n') quote = undefined;
    } else if (char === '#') {
      while (at + 1 < source.length && source[at + 1] !== '\n') {
        out += ' ';
        at += 1;
      }
      out += ' ';
    } else {
      if (char === '"' || char === "'") quote = char;
      out += char;
    }
  }
  return out;
}

const skipSpace = (source, at) => {
  let i = at;
  while (/\s/.test(source[i] ?? '')) i += 1;
  return i;
};

/** A literal at `at`: `{ value, end }`, or undefined for anything the kit does not read. */
function literal(source, from) {
  const at = skipSpace(source, from);
  const quote = source[at];
  if (quote === '"' || quote === "'") {
    let value = '';
    for (let i = at + 1; i < source.length && source[i] !== '\n'; i += 1) {
      if (source[i] === quote) return { value, end: i + 1 };
      if (source[i] === '\\') i += 1;
      value += source[i] ?? '';
    }
    return undefined;
  }
  if (quote === '[' || quote === '(') {
    const close = quote === '[' ? ']' : ')';
    const value = [];
    let i = skipSpace(source, at + 1);
    while (source[i] !== close) {
      const item = literal(source, i);
      if (item === undefined) return undefined;
      value.push(item.value);
      i = skipSpace(source, item.end);
      if (source[i] === ',') i = skipSpace(source, i + 1);
      else if (source[i] !== close) return undefined;
    }
    return { value, end: i + 1 };
  }
  const word = /^(-?\d+(?:\.\d+)?|True|False|None)\b/.exec(source.slice(at));
  return word === null ? undefined : { value: word[1], end: at + word[0].length };
}

/** A builtin's arguments from its `(`: `{ args, end }`, each `{ name, value }`, or undefined. */
function argumentsOf(source, open) {
  const args = [];
  let at = skipSpace(source, open + 1);
  while (source[at] !== ')') {
    const named = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(source.slice(at));
    if (named !== null) at += named[0].length;
    const item = literal(source, at);
    if (item === undefined) return undefined;
    args.push({ name: named?.[1], value: item.value });
    at = skipSpace(source, item.end);
    if (source[at] === ',') at = skipSpace(source, at + 1);
    else if (source[at] !== ')') return undefined;
  }
  return { args, end: at + 1 };
}

/**
 * A rules file's `prefix_rule` calls and what health cannot read in it:
 * `{ rules, unread }`, each rule `{ text, pattern, decision }` with its text as
 * the file has it, and `unread` the first statement it cannot read, or
 * undefined.
 */
function readRules(source) {
  const bare = uncommented(source);
  const rules = [];
  let unread;
  let at = skipSpace(bare, 0);
  while (at < bare.length) {
    const call = /^([A-Za-z_]\w*)\s*\(/.exec(bare.slice(at));
    const read = call !== null && BUILTINS.has(call[1]) ? argumentsOf(bare, at + call[0].length - 1) : undefined;
    if (read === undefined) {
      // One line on: what health cannot read is said once, and what it can still comes out.
      const line = bare.indexOf('\n', at);
      const end = line === -1 ? bare.length : line;
      unread ??= source.slice(at, end).trim();
      at = skipSpace(bare, end);
      continue;
    }
    if (call[1] === 'prefix_rule') {
      const pattern = read.args.find((arg) => arg.name === 'pattern') ?? read.args.find((arg) => arg.name === undefined);
      const decision = read.args.find((arg) => arg.name === 'decision');
      rules.push({ text: source.slice(at, read.end), pattern: pattern?.value, decision: decision === undefined ? 'allow' : decision.value });
    }
    at = skipSpace(bare, read.end);
    while (bare[at] === ';') at = skipSpace(bare, at + 1);
  }
  return { rules, unread };
}

/** The command prefixes a `prefix_rule` pattern stands for: an element that is a list is each of its words. */
function patternPrefixes(pattern) {
  if (!Array.isArray(pattern)) return [];
  return pattern.reduce((prefixes, element) => {
    const words = Array.isArray(element) ? element : [element];
    if (words.some((word) => typeof word !== 'string')) return [];
    return prefixes.flatMap((prefix) => words.map((word) => [...prefix, word])).slice(0, 256);
  }, [[]]);
}

/**
 * A rules file's `prefix_rule` calls that let the kit's run run any command,
 * as their text, and the first statement health cannot read: `{ runs, unread }`.
 * Codex matches a rule's words as the command's first words, each exactly.
 */
function codexRunRules(source) {
  const { rules, unread } = readRules(source);
  const runs = rules.filter(({ pattern, decision }) => decision === 'allow' && patternPrefixes(pattern).some((words) =>
    words.length > 0 && runsAnyThroughKit(words, [...globOf(words.join(' '), false), ' ', STAR], false)));
  return { runs: runs.map((rule) => rule.text), unread };
}

/**
 * Refuse the rules `permission allow` was given when any is broad, before anything is
 * written, naming the file the user can add it to themselves.
 */
export function refuseBroad(home, rules) {
  for (const rule of rules) {
    const why = broadness(rule);
    if (why === undefined) continue;
    throw new Error(`permission allow ${rule} is broad: ${why}. The kit writes only narrow, exact rules, such as Bash(gh pr merge:*), so nothing was written. If the user wants this rule for ${path.basename(home)}, they add it to ${path.join(home, FILE)} themselves.`);
  }
}

/** The rules the bot is allowed beyond the kit's defaults, in `allow`'s order. */
export const beyondDefaults = (bots, home, bot) => {
  const defaults = defaultRules(bots);
  return allowOf(home, bot).filter((rule) => !defaults.includes(rule));
};

/** Whether any of a bot's sessions, or the bot itself, runs on Claude Code. */
export const runsOnClaude = (bot) => bot.harness === 'claude'
  || bot.sessions.some((session) => harnessOf(session, bot.harness) === 'claude');

/** The rules the user allowed this bot, read from its bot.yaml, or a refusal naming the file. */
export function allowOf(home, bot) {
  const value = bot.allow;
  if (value === undefined || value === null) return [];
  const file = path.join(home, 'bot.yaml');
  if (!Array.isArray(value) || value.some((rule) => typeof rule !== 'string' || rule.trim() === '')) {
    throw new Error(`the allow entry in ${file} is not a list of permission rules, such as Bash(git add:*), so none of it is written. Fix it, then run the command again.`);
  }
  return value;
}

/** Whether any of a bot's sessions, or the bot itself, runs on Codex. */
export const runsOnCodex = (bot) => bot.harness === 'codex'
  || bot.sessions.some((session) => harnessOf(session, bot.harness) === 'codex');

/**
 * Whether the kit keeps the bot's Codex rules file: while the bot runs on
 * Codex, and after it has left Codex for as long as the file it wrote is
 * there in the bot folder, so the file never holds a rule that `allow` no
 * longer does (#613). A link out of the bot folder is not the kit's file.
 */
const keepsCodex = (bot, home) => runsOnCodex(bot)
  || (existsSync(path.join(home, CODEX_FILE)) && leadsOutside(home, path.join(home, CODEX_FILE)) === undefined);

/**
 * The default rules this bot is not allowed yet, in the default order. A bot
 * only on Codex is not given the Read rule: its sandbox reads every file
 * already.
 */
function missingDefaults(bots, home, bot) {
  const allowed = allowOf(home, bot);
  return botDefaults(bots, bot).filter((rule) => !allowed.includes(rule));
}

/**
 * The default rules a bot on Claude or Codex is given, in the default order:
 * what `bot create` writes into a new bot's bot.yaml (#595).
 */
export function botDefaults(bots, bot) {
  if (!runsOnClaude(bot) && !runsOnCodex(bot)) return [];
  return defaultRules(bots).filter((rule) => runsOnClaude(bot) || codexForm(rule).line !== undefined);
}

/**
 * A rule's Codex form: `{ line }`, `{ needless: true }` for a Read rule, which
 * Codex's sandbox does not need, or `{ why }` for a rule Codex has none for.
 * Only a prefix of plain words has one; a prefix rule for one exact command
 * would let the bot add any arguments the user did not say yes to.
 */
export function codexForm(rule) {
  if (/^Read(\(.*\))?$/s.test(rule)) return { needless: true };
  const bash = /^Bash\((.*)\)$/s.exec(rule);
  if (bash === null) return { why: 'Codex has no rule for anything but a command, so its sandbox decides it' };
  const { words, odd } = shellWords(bash[1]);
  if (odd !== undefined) return { why: `Codex has no rule for it: it holds ${odd}` };
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) {
    return { why: 'Codex has no rule for a command with a variable set in front of it' };
  }
  if (!words.some((word) => word.includes('*'))) {
    return { why: 'Codex has no rule for one exact command: its rules match a command\'s first words, whatever comes after them' };
  }
  // Only the wildcard comes off, ` *` or `:*` at the very end: every word
  // before it stays, an empty quoted one included, or the rule would be looser
  // than the one the user said yes to.
  const text = bash[1].trimEnd();
  const end = /(?: |:)\*$/.exec(text);
  const prefix = end === null ? [] : shellWords(text.slice(0, end.index)).words;
  if (prefix.length === 0 || prefix.some((word) => word.includes('*'))) {
    return { why: 'Codex has no rule for a wildcard anywhere but at the end, as a word of its own or after a colon' };
  }
  return { line: `prefix_rule(pattern=[${prefix.map((word) => JSON.stringify(word)).join(', ')}], decision="allow")` };
}

/**
 * Refuse the rules `permission allow` was given for a bot that runs only on Codex when
 * Codex has no form for one, before anything is written: recorded, it would
 * let the bot do nothing.
 */
export function refuseNoCodexForm(bot, rules) {
  if (runsOnClaude(bot) || !runsOnCodex(bot)) return;
  for (const rule of rules) {
    const { why } = codexForm(rule);
    if (why === undefined) continue;
    throw new Error(`permission allow ${rule} is not for ${bot.name}: ${why}, and ${bot.name} runs only on Codex, so nothing was written.`);
  }
}

/**
 * Add the default rules the bot is not allowed yet to its `allow` (ADR 0050),
 * then write what it is allowed into the files of the harnesses it runs on:
 * one entry per file, Claude's first, each with `defaults`, the rules this run
 * added, and `held`, the rules of commands no longer in the set that the bot
 * still holds (#548). The harness files are written first and bot.yaml last, as
 * `permission allow` writes them (#383). With `keepGoing`, a file the kit may
 * not write is an entry with its `trouble` rather than a throw.
 */
export function writePermissions(bots, home, bot, { keepGoing = false } = {}) {
  const writers = [[runsOnClaude, FILE], [keepsCodex, CODEX_FILE]].filter(([runs]) => runs(bot, home));
  let defaults = [];
  // Read before anything is written, so a file's trouble still names them.
  let held = [];
  try {
    held = heldRules(bots, home, bot);
    defaults = writers.length === 0 ? [] : missingDefaults(bots, home, bot);
    if (defaults.length > 0) {
      const { allow } = allowRules(bots, bot.name, defaults, { write: false });
      const entries = allowIn(bots, home, { ...bot, allow })();
      allowRules(bots, bot.name, defaults);
      return entries.map((entry) => ({ ...entry, defaults, held }));
    }
    return writers.map(([runs]) => (runs === runsOnClaude ? planClaude : planCodex)(bots, home, bot).write())
      .map((entry) => ({ ...entry, defaults, held }));
  } catch (error) {
    if (!keepGoing) throw error;
    return writers.map(([, file]) => ({ bot: bot.name, file: path.join(home, file), written: [], defaults: [], held, trouble: error.message }));
  }
}

/**
 * Check every file `permission allow` writes before any is written (#383):
 * bot.yaml, and the files of the harnesses the bot runs on, read and found
 * writable. `bot` is the bot as it will be, with the new rules in `allow`.
 * What comes back writes the harness files, one entry per file, Claude's
 * first; the caller writes bot.yaml after, so a write that fails leaves
 * `allow` as it was, for the same command to run again.
 */
export function allowIn(bots, home, bot) {
  refuseUnwritable(path.join(home, 'bot.yaml'));
  const plans = [[runsOnClaude, planClaude], [keepsCodex, planCodex]]
    .filter(([runs]) => runs(bot, home)).map(([, plan]) => plan(bots, home, bot));
  for (const plan of plans) if (plan.writes) refuseUnwritable(plan.answer.file);
  return () => plans.map((plan) => plan.write());
}

/**
 * What writing the bot's allowed rules into its Claude settings would do,
 * read and refused before anything is written: `{ answer, writes, write }`.
 * `write()` gives `{ bot, file, written }`, with `written` the rules
 * it added.
 *
 * Only rules `allow` holds are written. Everything else in the file stays as it
 * is, the user's own entries and their order included; a rule missing from the
 * file goes after them, and a run with nothing to add writes nothing.
 */
function planClaude(bots, home, bot) {
  const file = path.join(home, FILE);
  const allowed = allowOf(home, bot);
  const answer = { bot: bot.name, file, written: [] };
  const none = { answer, writes: false, write: () => answer };
  if (allowed.length === 0) return none;

  refuseOutside(home, file);
  const settings = readSettings(file, 'the permission rules the user allowed');
  const present = presentIn(settings, file);
  const missing = [...new Set(allowed)].filter((rule) => !present.includes(rule));
  if (missing.length === 0) return none;

  const wanted = { ...settings, permissions: { ...settings.permissions, allow: [...present, ...missing] } };
  return {
    answer,
    writes: true,
    write: () => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(wanted, null, 2)}\n`);
      return { ...answer, written: missing };
    },
  };
}

/**
 * Take the rules the user said yes to taking back out of the files of the
 * harnesses the bot runs on (#360): from its Claude settings every entry of
 * that exact text and nothing else, and its Codex rules rewritten from what
 * `allow` still holds. Only rules `allow` holds are taken back; one it does not
 * hold is refused, since the kit did not write it (ADR 0040).
 *
 * Everything is checked before anything is written, a file the kit could not
 * write included, bot.yaml too. What comes back writes the files: one entry per file,
 * Claude's first, with `removed` the rules taken out of it. The caller takes
 * them out of `allow` after, so a write that fails leaves them there to take
 * back again.
 */
export function takeBack(bots, home, bot, rules) {
  const allowed = allowOf(home, bot);
  const foreign = rules.find((rule) => !allowed.includes(rule));
  if (foreign !== undefined) throw new Error(notAllowed(home, bot, foreign));
  // The next rules write would add it again (ADR 0040).
  const kits = rules.find((rule) => defaultRules(bots).includes(rule));
  if (kits !== undefined) {
    throw new Error(`permission disallow ${kits} is one of the kit's default rules, which every bot has (#527). The kit writes it again at its next rules write, so it is not taken back, and nothing was changed.`);
  }
  const after = { ...bot, allow: allowed.filter((rule) => !rules.includes(rule)) };
  const taken = [...new Set(rules)];
  // bot.yaml is written last, and a harness file taken out of step with it
  // would leave nothing to say a running Codex session still has the rule.
  refuseUnwritable(path.join(home, 'bot.yaml'));

  const file = path.join(home, FILE);
  let claude;
  if (runsOnClaude(bot)) {
    refuseOutside(home, file);
    const settings = readSettings(file, 'the permission rules the user allowed');
    const present = presentIn(settings, file);
    claude = { settings, present, removed: taken.filter((rule) => present.includes(rule)) };
    if (claude.removed.length > 0) refuseUnwritable(file);
  }
  const codex = path.join(home, CODEX_FILE);
  let before = [];
  const codexKept = keepsCodex(bot, home);
  if (codexKept) {
    refuseOutside(home, codex);
    if (existsSync(codex)) {
      before = ruleLines(readFileSync(codex, 'utf8'));
      refuseUnwritable(codex);
    }
  }

  return () => {
    const entries = [];
    if (claude !== undefined) {
      const { settings, present, removed } = claude;
      if (removed.length > 0) {
        const allow = present.filter((rule) => !removed.includes(rule));
        writeFileSync(file, `${JSON.stringify({ ...settings, permissions: { ...settings.permissions, allow } }, null, 2)}\n`);
      }
      entries.push({ bot: bot.name, file, written: [], removed });
    }
    if (codexKept) {
      const entry = planCodex(bots, home, after).write();
      // A line goes only when no rule still allowed gives it.
      const kept = [...codexOf(home, after).lines.keys()];
      const removed = taken.filter((rule) => {
        const { line } = codexForm(rule);
        return line !== undefined && before.includes(line) && !kept.includes(line);
      });
      entries.push({ ...entry, written: [], removed });
    }
    return entries;
  };
}

/**
 * A refusal, before anything is written, of a file the kit could not write: one
 * not there yet is made in the nearest folder that is, which the kit must be
 * able to enter and write in, and which must be a folder.
 */
function refuseUnwritable(file) {
  let where = file;
  while (!existsSync(where) && path.dirname(where) !== where) where = path.dirname(where);
  try {
    if (where !== file && !statSync(where).isDirectory()) throw Object.assign(new Error('not a folder'), { code: 'ENOTDIR' });
    accessSync(where, where === file ? constants.W_OK : constants.W_OK | constants.X_OK);
  } catch (error) {
    const at = where === file ? '' : ` at ${where}`;
    throw new Error(`${file} cannot be written (${error.code ?? error.message}${at}), so nothing was changed. Let the kit write it, then run the command again.`);
  }
}

/** Why `permission disallow` refuses a rule `allow` does not hold, and where one of that text is. */
function notAllowed(home, bot, rule) {
  const yaml = path.join(home, 'bot.yaml');
  const file = path.join(home, FILE);
  let byHand = false;
  try {
    byHand = runsOnClaude(bot) && leadsOutside(home, file) === undefined
      && presentIn(readSettings(file), file).includes(rule);
  } catch {
    // A file the kit cannot read holds nothing it would take out.
  }
  const where = byHand
    ? ` ${file} allows it, which the user added by hand, not the kit: it stays theirs, to take out themselves.`
    : '';
  return `permission disallow ${rule} is not in the allow list in ${yaml}, so it is not the kit's to take back, and nothing was changed.${where} The kit takes back only rules that list holds, spelled exactly as they are there.`;
}

/**
 * The Codex form of what the bot is allowed: the file's rule lines, each once,
 * with the rules that gave them, and the rules Codex has no form for.
 */
function codexOf(home, bot) {
  const lines = new Map();
  const unwritten = [];
  for (const rule of allowOf(home, bot)) {
    const form = codexForm(rule);
    if (form.why !== undefined) unwritten.push({ rule, why: form.why });
    if (form.line === undefined) continue;
    lines.set(form.line, [...(lines.get(form.line) ?? []), rule]);
  }
  return { lines, unwritten };
}

/** The lines of a rules file that are rules: not blank, not a comment. */
const ruleLines = (text) => text.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));

/**
 * What writing the Codex form of what the bot is allowed into
 * `.codex/rules/obk.rules` would do, as `planClaude` gives it. `write()` gives
 * `{ bot, file, written, unwritten }`, with `written` every rule in
 * the file when it wrote it. The kit owns the file whole and writes it only
 * when it would change; with nothing to write and no file, it makes none.
 */
function planCodex(bots, home, bot) {
  const file = path.join(home, CODEX_FILE);
  const { lines, unwritten } = codexOf(home, bot);
  const answer = { bot: bot.name, file, written: [], unwritten };
  const none = { answer, writes: false, write: () => answer };
  if (lines.size === 0 && !existsSync(file)) return none;

  refuseOutside(home, file);
  const text = [
    `# Written by obk from ${bot.name}'s bot.yaml, where the user's yes to each rule is kept.`,
    '# obk rewrites this whole file: put rules of your own in another file in this folder.',
    ...lines.keys(),
  ].join('\n');
  if (existsSync(file) && readFileSync(file, 'utf8') === `${text}\n`) return none;
  return {
    answer,
    writes: true,
    write: () => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${text}\n`);
      return { ...answer, written: [...lines.values()].flat() };
    },
  };
}

/**
 * What health has to say about a bot's permission rules: `{ where, says }` for
 * each entry in the file that `allow` does not hold, each rule `allow`
 * holds that the file lacks, and each rule in `allow` or in the bot's local
 * Claude settings that lets the kit's run run any command (#635). Read only:
 * an entry the kit did not write is named, never taken out.
 */
export function permissionsTrouble(bots, home, bot) {
  let allowed;
  try {
    allowed = allowOf(home, bot);
  } catch (error) {
    if (!runsOnClaude(bot) && !runsOnCodex(bot)) return [];
    return [{ where: path.join(home, 'bot.yaml'), says: error.message }];
  }
  return [
    ...allowRunTrouble(bots, home, bot, allowed),
    ...claudeTrouble(home, bot, allowed),
    ...(runsOnClaude(bot) ? claudeRunTrouble(path.join(home, '.claude', 'settings.local.json'), bot.name) : []),
    ...codexTrouble(home, bot),
  ];
}

/**
 * Each rule in `allow` that lets the kit's run run any command. `permission
 * allow` refuses one, so it came into bot.yaml by hand, and the kit writes
 * what `allow` holds into the bot's harness files; the kit takes it back
 * through `permission disallow`, after the user's yes.
 */
function allowRunTrouble(bots, home, bot, allowed) {
  if (!runsOnClaude(bot) && !runsOnCodex(bot)) return [];
  const yaml = path.join(home, 'bot.yaml');
  return [...new Set(allowed)].filter(letsRunAnything).map((rule) => ({
    where: yaml,
    says: `${yaml} allows ${rule}, and with obk run it lets ${bot.name} run any command as ${RUN_FORM}, with no judgment by auto mode or Codex's review: the kit writes what this allow list holds into ${bot.name}'s harness files. obk permission allow does not record such a rule, so it came into the file by hand. To close the gap, after the user's yes, run ${shellWord(ownCli())} permission disallow --bots ${shellWord(bots)} --bot ${shellWord(bot.name)} --rule ${shellWord(rule)}.`,
  }));
}

/** Health's findings in the bot's Claude settings. */
function claudeTrouble(home, bot, allowed) {
  if (!runsOnClaude(bot)) return [];
  const file = path.join(home, FILE);
  // A file that is not there, or a link out of the bot folder, is named by the
  // hook's check already, which reads this file for every bot with a Claude
  // session, and `obk up` puts back the hook and the rules together. Here it
  // matters only for a bot without one, when there are rules to write.
  const hookNamesIt = bot.sessions.some((session) => harnessOf(session, bot.harness) === 'claude');
  if (!existsSync(file) && (allowed.length === 0 || hookNamesIt)) return [];
  if ((allowed.length === 0 || hookNamesIt) && leadsOutside(home, file) !== undefined) return [];

  let present;
  try {
    refuseOutside(home, file);
    present = presentIn(readSettings(file, 'the permission rules the user allowed'), file);
  } catch (error) {
    return [{ where: file, says: error.message }];
  }

  return [
    ...present.filter((rule) => !allowed.includes(rule)).map((rule) => ({
      where: file,
      // One `permission allow` would refuse was added by the user by hand, which the
      // boundary leaves to them: named, in neutral words, and left alone.
      says: letsRunAnything(rule) ? claudeRunSays(file, rule, bot.name) : broadness(rule) === undefined
        ? `${file} allows ${rule}, and ${bot.name}'s bot.yaml does not: the kit did not write it. It stays where it is. If the user wants it, record their yes with obk permission allow; if not, take it out of the file.`
        : `${file} allows ${rule}, which the user added by hand, not the kit. It stays where it is.`,
    })),
    // One finding for all the rules it lacks: with the kit's default set, a
    // file written by hand can lack forty.
    ...missingIn(allowed.filter((rule) => !present.includes(rule)), (missing) => ({
      where: file,
      says: `${file} does not hold ${missing.length === 1 ? missing[0] : `these ${missing.length} rules`}, which ${bot.name}'s bot.yaml allows, so ${bot.name}'s Claude sessions are asked about ${missing.length === 1 ? 'it' : `them: ${missing.join(', ')}`}. obk up writes ${missing.length === 1 ? 'it' : 'them'}.`,
    })),
  ];
}

/**
 * Health's findings in the bot's Codex rules: each rule in a file of the
 * user's beside obk.rules, named and left alone, and an obk.rules that is not
 * what the kit writes from `allow`.
 */
function codexTrouble(home, bot) {
  if (!runsOnCodex(bot)) return [];
  const folder = path.join(home, CODEX_RULES);
  const file = path.join(home, CODEX_FILE);
  const { lines } = codexOf(home, bot);
  if (leadsOutside(home, file) !== undefined) {
    if (lines.size === 0) return [];
    try {
      refuseOutside(home, file);
    } catch (error) {
      return [{ where: file, says: error.message }];
    }
  }

  let names = [];
  try {
    names = existsSync(folder) ? readdirSync(folder) : [];
  } catch (error) {
    return unread(folder, error);
  }
  const theirs = names
    .filter((name) => name.endsWith('.rules') && name !== path.basename(file))
    .sort()
    .flatMap((name) => {
      const where = path.join(folder, name);
      let text;
      try {
        text = readFileSync(where, 'utf8');
      } catch (error) {
        return unread(where, error);
      }
      // A rule that lets the kit's run run any command and is not one whole
      // line, over several lines or with a comment after it, is named whole.
      const { runs, unread: hidden } = codexRunRules(text);
      const lines = ruleLines(text);
      return [
        ...lines.map((line) => ({
          where,
          says: runs.includes(line) ? codexRunSays(where, line, bot.name) : `${where} holds ${line}, which the user added, not the kit. It stays where it is.`,
        })),
        ...runs.filter((rule) => !lines.includes(rule)).map((rule) => ({ where, says: codexRunSays(where, rule, bot.name) })),
        ...unclear(where, hidden, bot.name),
      ];
    });

  const wanted = [...lines.keys()];
  let present = [];
  try {
    present = existsSync(file) ? ruleLines(readFileSync(file, 'utf8')) : [];
  } catch (error) {
    return [...theirs, ...unread(file, error)];
  }
  const missing = wanted.filter((line) => !present.includes(line));
  const extra = present.filter((line) => !wanted.includes(line));
  if (missing.length === 0 && extra.length === 0) return theirs;
  const what = [
    ...(missing.length === 0 ? [] : [`it lacks ${missing.join(' and ')}, which ${bot.name}'s bot.yaml allows`]),
    ...(extra.length === 0 ? [] : [`it holds ${extra.join(' and ')}, which the kit did not write`]),
  ].join(', and ');
  return [...theirs, {
    where: file,
    says: `${file} is not what the kit writes from ${bot.name}'s bot.yaml: ${what}. The kit owns this file, and obk up rewrites it; a rule of the user's own goes in another file in ${folder}.`,
  }];
}

/** How the kit's run is called, as a finding names it. */
const RUN_FORM = 'obk run --timeout <seconds> -- <command>';

/**
 * What the user does about a rule that lets the kit's run run any command, in
 * a file the kit did not write: the user's own, or the machine's policy.
 */
const takeOut = (file, policy = false) => `It stays where it is: ${file} is ${policy ? "this machine's policy" : "the user's"}, not the kit's. To close the gap, ${policy ? 'whoever keeps that policy takes' : 'the user takes'} the rule out of the file. The kit's default rules already allow the kit's own commands, narrowed to this bots folder, and a bounded run gets a narrow rule of its own, such as Bash(${shellWord(ownCli())} run --timeout 300 -- go test:*), through obk permission allow after the user's yes.`;

/** Health's words on a Claude rule the kit did not write that lets the kit's run run any command (#635). */
const claudeRunSays = (file, rule, who, policy) => `${file} allows ${rule}, which the kit did not write. With obk run, it also lets ${who} run any command as ${RUN_FORM}, and auto mode does not judge that command. ${takeOut(file, policy)}`;

/** Health's words on such a Codex rule. An allowed command runs outside Codex's sandbox, with no review. */
const codexRunSays = (file, rule, who, policy) => `${file} holds ${rule}, which the kit did not write. With obk run, it also lets ${who} run any command as ${RUN_FORM}, outside Codex's sandbox and with no review. ${takeOut(file, policy)}`;

/**
 * Health's words on a Codex rules file that holds what health does not read,
 * such as a pattern kept in a variable: it cannot tell what the file allows.
 */
const unclear = (where, part, who) => (part === undefined ? [] : [{
  where,
  says: `${where} holds ${part}, which health does not read: it reads only prefix_rule, host_executable and network_rule calls written out in full. So it cannot tell whether a rule there lets ${who} run whatever command obk run is given. It stays where it is. To check the file, run codex execpolicy check --rules ${shellWord(where)} with the kit's run, such as obk run --timeout 300 -- sh -c true, and read its decision.`,
}]);

/** A file health cannot read is one finding of its own, and the rest of the fleet's health still comes out. */
const unread = (where, error) => [{ where, says: `${where} could not be read (${error.code ?? error.message}), so health cannot say what it holds. It stays where it is.` }];

/**
 * Health's findings on each rule in a Claude settings file the kit does not
 * write that lets the kit's run run any command.
 */
function claudeRunTrouble(file, who, policy) {
  if (!existsSync(file)) return [];
  let present;
  try {
    present = presentIn(readSettings(file, 'permission rules'), file);
  } catch (error) {
    return [{ where: file, says: error.message }];
  }
  return [...new Set(present)].filter((rule) => typeof rule === 'string' && letsRunAnything(rule))
    .map((rule) => ({ where: file, says: claudeRunSays(file, rule, who, policy) }));
}

/**
 * Health's findings on each rule in the `.rules` files of a Codex rules
 * folder the kit does not write that lets the kit's run run any command.
 */
function codexRunTrouble(folder, who, policy) {
  let names;
  try {
    names = existsSync(folder) ? readdirSync(folder) : [];
  } catch (error) {
    return unread(folder, error);
  }
  return names.filter((name) => name.endsWith('.rules')).sort().flatMap((name) => {
    const where = path.join(folder, name);
    try {
      if (!statSync(where).isFile()) return [];
      const { runs, unread: hidden } = codexRunRules(readFileSync(where, 'utf8'));
      return [...runs.map((rule) => ({ where, says: codexRunSays(where, rule, who, policy) })), ...unclear(where, hidden, who)];
    } catch (error) {
      return unread(where, error);
    }
  });
}

/** The nearest folder at or above `from` that holds `.git`: the repository both harnesses read project files up to. */
function repoRoot(from) {
  for (let at = path.resolve(from); ; at = path.dirname(at)) {
    if (existsSync(path.join(at, '.git'))) return at;
    if (path.dirname(at) === at) return undefined;
  }
}

/**
 * What health has to say, for the whole fleet, about the allow lists every
 * bot's harness reads beside its own folder (#635): each rule there that lets
 * the kit's run run any command. Claude Code reads the user's settings, and,
 * for a session started below a git repository's root, the local settings at
 * that root; Codex reads the user's rules, and the rules of each folder from
 * the root down to the session's, once the project is trusted. Both read the
 * machine's policy too; Claude's can also come from MDM or the claude.ai
 * console, which no file shows. Read only: the kit names a rule there, never
 * takes it out.
 */
export function kitRunTrouble(bots, { claude, codex }) {
  const root = repoRoot(botsDir(bots));
  // OBK_POLICY_ROOT stands for `/` where the policy folders are, as in a test.
  const system = process.env.OBK_POLICY_ROOT || path.parse(process.cwd()).root;
  const found = [];
  if (claude) {
    const managed = path.join(system, process.platform === 'darwin' ? 'Library/Application Support/ClaudeCode' : 'etc/claude-code');
    const policy = 'every bot\'s Claude sessions';
    found.push(...claudeRunTrouble(path.join(managed, 'managed-settings.json'), policy, true));
    const parts = path.join(managed, 'managed-settings.d');
    let names = [];
    try {
      names = existsSync(parts) ? readdirSync(parts) : [];
    } catch (error) {
      found.push(...unread(parts, error));
    }
    for (const name of names.filter((one) => one.endsWith('.json') && !one.startsWith('.')).sort()) {
      found.push(...claudeRunTrouble(path.join(parts, name), policy, true));
    }
    const user = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    found.push(...claudeRunTrouble(path.join(user, 'settings.json'), 'every bot\'s Claude sessions'));
    if (root !== undefined && root !== os.homedir()) {
      found.push(...claudeRunTrouble(path.join(root, '.claude', 'settings.local.json'), `the Claude sessions of every bot in ${root}`));
    }
  }
  if (codex) {
    const user = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    found.push(...codexRunTrouble(path.join(system, 'etc/codex/rules'), 'every bot\'s Codex sessions', true));
    found.push(...codexRunTrouble(path.join(user, 'rules'), 'every bot\'s Codex sessions'));
    const folders = [];
    for (let at = botsDir(bots); root !== undefined; at = path.dirname(at)) {
      folders.unshift(at);
      if (at === root || path.dirname(at) === at) break;
    }
    for (const folder of folders) {
      if (path.resolve(folder, '.codex') === path.resolve(user)) continue;
      found.push(...codexRunTrouble(path.join(folder, '.codex', 'rules'), `the Codex sessions of every bot in ${folder}`));
    }
  }
  return found;
}

/** One finding about `missing`, made by `finding`, or none when nothing is missing. */
const missingIn = (missing, finding) => (missing.length === 0 ? [] : [finding([...new Set(missing)])]);

/** The file's `permissions.allow`, or a refusal when it is there and is not a list. */
function presentIn(settings, file) {
  const permissions = settings.permissions;
  if (permissions === undefined) return [];
  if (permissions === null || typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new Error(`${file} has a permissions entry that is not a mapping, and the permission rules the user allowed go in it. Fix it or move it aside, then run the command again.`);
  }
  if (permissions.allow === undefined) return [];
  if (!Array.isArray(permissions.allow)) {
    throw new Error(`${file} has a permissions.allow entry that is not a list, and the permission rules the user allowed go in it. Fix it or move it aside, then run the command again.`);
  }
  return permissions.allow;
}

/** The kit writes a bot's settings in the bot folder and nowhere else (ADR 0022). */
function refuseOutside(home, file) {
  const real = leadsOutside(home, file);
  if (real === undefined) return;
  throw new Error(`${file} leads outside the bot folder, to ${real}, through a link, and the kit writes permission rules only inside the bot folder. Replace the link with a file of the bot's own, then run the command again.`);
}
