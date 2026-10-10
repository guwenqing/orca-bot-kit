// The permission rules a bot may run with, written into its own Claude
// settings: the kit's default set, and the rules its user said yes to (#344).
//
// A bot in auto mode is stopped by the harness's check for things the kit's own
// rules tell every bot to do: run the kit's commands, read a long message's
// body beside the bots folder, commit. A matching allow rule is settled before
// that check (Claude Code's permissions docs), so the kit gives every bot a
// default set, spelled with its real CLI and bots folder, with nobody asked
// (#527, ADR 0036). A rule beyond it is the user's yes, which
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
import path from 'node:path';

import { allowRules, leadsOutside } from './bot.js';
import { COMMANDS, KEPT_BACK } from './commands.js';
import { readSettings } from './hooks.js';
import { harnessOf, ownCli, shellWord } from './launch.js';

/** Where Claude Code reads a project's settings, inside the bot home. */
const FILE = '.claude/settings.json';

/** Where Codex reads a trusted project's rules, and the one file of them the kit owns. */
const CODEX_RULES = '.codex/rules';
const CODEX_FILE = `${CODEX_RULES}/obk.rules`;

/**
 * The rules every bot is given (ADR 0036): each of the kit's commands but those
 * kept back for the user's yes (ADR 0037), narrowed to this bots folder and
 * spelled as the kit prints them, which is what a bot runs; reading a long
 * message; committing; and the check Orca's mail notice tells a session to
 * run. `//` is Claude's form for an absolute path.
 */
export function defaultRules(bots, cli = ownCli()) {
  const kit = shellWord(cli);
  const folder = shellWord(bots);
  return [
    ...Object.keys(COMMANDS).filter((command) => !KEPT_BACK.includes(command))
      .map((command) => `Bash(${kit} ${command} --bots ${folder}:*)`),
    `Read(/${bots}.messages/**)`,
    'Bash(git add:*)',
    'Bash(git commit:*)',
    'Bash(orca orchestration check --run:*)',
  ];
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
  if (runnerOf(program) !== undefined) {
    // Only what runs, fixed by its absolute path, narrows it. A wrapper's
    // program is then judged by itself; an interpreter's script is the end.
    const next = (words[1] ?? '').replace(/:\*$/, '');
    const fixed = next.startsWith('/') && !next.includes('*');
    if (fixed && WRAPPERS.has(program)) return commandBroadness(words.slice(1));
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
 * The default rules this bot is not allowed yet, in the default order. A bot
 * only on Codex is not given the Read rule: its sandbox reads every file
 * already.
 */
function missingDefaults(bots, home, bot) {
  const allowed = allowOf(home, bot);
  return defaultRules(bots)
    .filter((rule) => runsOnClaude(bot) || codexForm(rule).line !== undefined)
    .filter((rule) => !allowed.includes(rule));
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
 * Add the default rules the bot is not allowed yet to its `allow` (ADR 0036),
 * then write what it is allowed into the files of the harnesses it runs on:
 * one entry per file, Claude's first, each with `defaults`, the rules this run
 * added. The harness files are written first and bot.yaml last, as
 * `permission allow` writes them (#383). With `keepGoing`, a file the kit may
 * not write is an entry with its `trouble` rather than a throw.
 */
export function writePermissions(bots, home, bot, { keepGoing = false } = {}) {
  const writers = [[runsOnClaude, FILE], [runsOnCodex, CODEX_FILE]].filter(([runs]) => runs(bot));
  let defaults = [];
  try {
    defaults = writers.length === 0 ? [] : missingDefaults(bots, home, bot);
    if (defaults.length > 0) {
      const { allow } = allowRules(bots, bot.name, defaults, { write: false });
      const entries = allowIn(bots, home, { ...bot, allow })();
      allowRules(bots, bot.name, defaults);
      return entries.map((entry) => ({ ...entry, defaults }));
    }
    return writers.map(([runs]) => (runs === runsOnClaude ? planClaude : planCodex)(bots, home, bot).write())
      .map((entry) => ({ ...entry, defaults }));
  } catch (error) {
    if (!keepGoing) throw error;
    return writers.map(([, file]) => ({ bot: bot.name, file: path.join(home, file), written: [], defaults: [], trouble: error.message }));
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
  const plans = [[runsOnClaude, planClaude], [runsOnCodex, planCodex]]
    .filter(([runs]) => runs(bot)).map(([, plan]) => plan(bots, home, bot));
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
  if (runsOnCodex(bot)) {
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
    if (runsOnCodex(after)) {
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
 * each entry in the file that `allow` does not hold, and each rule `allow`
 * holds that the file lacks. Read only: an entry the kit did not write is named,
 * never taken out.
 */
export function permissionsTrouble(home, bot) {
  let allowed;
  try {
    allowed = allowOf(home, bot);
  } catch (error) {
    if (!runsOnClaude(bot) && !runsOnCodex(bot)) return [];
    return [{ where: path.join(home, 'bot.yaml'), says: error.message }];
  }
  return [...claudeTrouble(home, bot, allowed), ...codexTrouble(home, bot)];
}

/** Health's findings in the bot's Claude settings. */
function claudeTrouble(home, bot, allowed) {
  if (!runsOnClaude(bot)) return [];
  const file = path.join(home, FILE);
  if (!existsSync(file) && allowed.length === 0) return [];

  // A link out of the bot folder is named by the hook's check already; here it
  // matters only when there are rules the kit would write through it.
  if (allowed.length === 0 && leadsOutside(home, file) !== undefined) return [];

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
      says: broadness(rule) === undefined
        ? `${file} allows ${rule}, and ${bot.name}'s bot.yaml does not: the kit did not write it. It stays where it is. If the user wants it, record their yes with obk permission allow; if not, take it out of the file.`
        : `${file} allows ${rule}, which the user added by hand, not the kit. It stays where it is.`,
    })),
    ...allowed.filter((rule) => !present.includes(rule)).map((rule) => ({
      where: file,
      says: `${file} does not hold ${rule}, which ${bot.name}'s bot.yaml allows, so ${bot.name}'s Claude sessions are asked about it. obk up writes it.`,
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

  // A file health cannot read is one finding of its own, and the rest of the
  // fleet's health still comes out.
  const unread = (where, error) => [{ where, says: `${where} could not be read (${error.code ?? error.message}), so health cannot say what it holds. It stays where it is.` }];
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
      return ruleLines(text).map((line) => ({
        where,
        says: `${where} holds ${line}, which the user added, not the kit. It stays where it is.`,
      }));
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
