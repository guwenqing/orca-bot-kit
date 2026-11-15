// A bot's `AGENTS.md`, built from its charter and the rule units it carries
// (PRD 6.6, ADR 0013).
//
// This is the one place the kit's own text lands inside the user's repo, so the
// promise around it is narrow: the build owns one marked block and nothing else
// in the file. What is written outside the markers is the user's and comes back
// exactly as they left it. The begin marker carries a checksum of what the build
// last put between the markers, so a hand edit inside the block is seen and
// stops the build rather than being written over.
//
// Two shelves of units. The kit's own are in `rules/` in the package, and every
// one of them marked `applies: all` is carried by every bot. The user's are in
// `rules/` in their bots folder. Anything beyond the defaults is named in a
// list — `defaults.yaml` for every bot, a `bot.yaml` for one — as `kit:<name>`
// for one of the kit's or a bare name for one of theirs.

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { readBook } from './book.js';
import { botDir, botNames, displayName, readBot, refuseOutside } from './bot.js';
import { dropRemovedHooks } from './hooks.js';
import { claudeTextFolder, harnessOf, kitFolders, ownCli, runsOnPi, shellWord } from './launch.js';

/** The kit's own units, inside the installed package. */
const KIT_RULES = fileURLToPath(new URL('../rules', import.meta.url));

/**
 * How a rule unit names the kit, and what the build writes in its place: the
 * CLI that builds the file, by its own path. A bot runs the command as the file
 * gives it, and Claude Code matches an allow rule against the command as
 * written, not after the shell expands a variable, so a bot told to run
 * `"${OBK_CLI:-obk}"` would never match the kit's own mail rule (#344).
 */
const KIT_WORD = '"${OBK_CLI:-obk}"';

/** How a rule unit names the bots folder, which the build writes out for the same reason. */
const BOTS_WORD = '<bots>';

/** What a name in a list carries to mean one of the kit's rather than one of the user's. */
const KIT = 'kit:';

/** The file a bot's rules are built into, and the name Claude Code is certain to read. */
const AGENTS = 'AGENTS.md';
const CLAUDE = 'CLAUDE.md';

/** All Codex reads of an instructions file (tech notes, section 3). */
export const CODEX_CAP = 32 * 1024;

/** The end of the block. Nothing of the build's own is in it, so it is matched whole. */
const END = '<!-- obk:rules end -->';

/** The start of it: the checksum, then a sentence for whoever opens the file. */
const BEGIN = /^<!-- obk:rules ([0-9a-f]{16})\b.*-->$/;
const beginLine = (sum) =>
  `<!-- obk:rules ${sum} — built by obk from bot.yaml and the rule units; write your own text below the end marker. -->`;

/**
 * What the block is stamped with: enough of a hash that the build can tell its
 * own text from a line somebody typed in, and short enough to read. It answers
 * one question — is this still the block the build left? — and nothing else.
 */
const checksum = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * Build the `AGENTS.md` of one bot. Returns what there is to report about it:
 * `{ bot, file, state, units, bytes }` for a file the build owns, and
 * `{ bot, file, state, trouble }` for one it will not touch.
 *
 * The two kinds of trouble are told apart by which half of the work failed.
 * What the bot carries is `failed` — a name that resolves to nothing, a unit
 * that cannot be read — and the user fixes it in a list. The file itself is
 * `conflict`, which only the person who edited it can settle.
 *
 * A bot that runs on Pi has `pi: true` too, for the report to say what the
 * kit does and does not write for Pi (#659).
 */
export function buildAgents(bots, home, bot) {
  const built = agentsInto(bots, home, bot);
  return runsOnPi(bot) ? { ...built, pi: true } : built;
}

function agentsInto(bots, home, bot) {
  const file = path.join(home, AGENTS);

  let built;
  try {
    built = blockFor(bots, bot);
  } catch (error) {
    return { bot: bot.name, file, state: 'failed', trouble: error.message };
  }

  let state;
  try {
    refuseOutside(home, file);
    state = writeBlock(file, built.body);
  } catch (error) {
    return { bot: bot.name, file, state: 'conflict', trouble: error.message };
  }

  // A Claude Code bot's main units leave the file its Claude sessions load and
  // go into their system text instead, built in this same step (R6). The system
  // file is written first: when it cannot be, CLAUDE.md keeps every unit, so
  // that no session loses one.
  const system = isClaudeBot(bot) ? writeSystem(bots, home, bot.name, built.system) : {};
  const loaded = system.trouble === undefined ? built.claude : built.body;
  const claude = isClaudeBot(bot) ? claudeFile(home, file, loaded) : claudeMd(home, file);
  const older = systemTrouble(bots, home, bot);
  const trouble = [claude.trouble, system.trouble].filter((one) => one !== undefined);
  return {
    bot: bot.name, file, state, units: built.units, bytes: statSync(file).size, ...claude, ...system,
    ...(trouble.length === 0 ? {} : { trouble: trouble.join(' ') }),
    ...(older.length === 0 ? {} : { older }),
  };
}

/**
 * Whether a session of this bot runs on Claude Code, the harness whose system
 * text the kit builds (R6): a session in bot.yaml, or an option of a role its
 * temporary sessions are made in.
 */
export function isClaudeBot(bot) {
  if (bot.sessions.some((session) => harnessOf(session, bot.harness) === 'claude')) return true;
  const roles = bot.temp_roles;
  if (roles === null || typeof roles !== 'object' || Array.isArray(roles)) return false;
  return Object.values(roles).some((role) => {
    const options = Array.isArray(role) ? role : Array.isArray(role?.options) ? role.options : [];
    return options.some((option) => option !== null && typeof option === 'object' && (option.harness ?? bot.harness) === 'claude');
  });
}

/**
 * Build every bot in the folder, or the one named, in name order. This is the
 * whole of `obk rules build`: it writes files and asks Orca nothing.
 *
 * One bot's trouble is one bot's: a bad list or an edited file stops that bot
 * and the others are built as usual.
 */
export function buildRules(bots, { bot: onlyBot } = {}) {
  const names = botNames(bots);
  if (onlyBot !== undefined && !names.includes(onlyBot)) {
    throw new Error(`there is no bot called ${onlyBot} in ${bots}. The bots there are: ${names.join(', ')}.`);
  }

  return (onlyBot === undefined ? names : [onlyBot]).map((name) => {
    const home = botDir(bots, name);
    let built;
    try {
      built = buildAgents(bots, home, readBot(home, name));
    } catch (error) {
      // A `bot.yaml` the kit cannot read at all. Same answer as a list it
      // cannot follow: this bot is not built, and nothing else changes.
      built = { bot: name, file: path.join(home, AGENTS), state: 'failed', trouble: error.message };
    }
    // Every bot, a paused one too, so this is the command that reaches each
    // hooks file the kit wrote, whatever the bot's sessions run on now (#613).
    // A file it cannot write is this bot's trouble, as above.
    try {
      dropRemovedHooks(home);
    } catch (error) {
      return { ...built, trouble: [built.trouble, error.message].filter((one) => one !== undefined).join(' ') };
    }
    return built;
  });
}

/**
 * What the block should hold: the bot's name, its charter, and every unit it
 * carries under its own title. Returns the text and the unit names in the order
 * they were written.
 */
export function blockFor(bots, bot) {
  const units = unitsFor(bots, bot);
  const head = [`# ${displayName(bot.name)}`];

  const charter = typeof bot.charter === 'string' ? bot.charter.trim() : '';
  if (charter !== '') head.push('## Charter', charter);
  const section = (unit) => [`## ${unit.title}`, unit.body.replaceAll(KIT_WORD, shellWord(ownCli())).replaceAll(BOTS_WORD, shellWord(bots))];
  const text = (chosen) => chosen.flatMap(section).join('\n\n');

  return {
    body: [...head, ...units.flatMap(section)].join('\n\n'),
    // What a Claude Code session loads from CLAUDE.md, what the kit appends to
    // its system text, and what the hook gives a session whose launch line
    // appends nothing (R6).
    claude: [...head, ...units.filter((unit) => unit.placement !== 'main').flatMap(section)].join('\n\n'),
    system: text(units.filter((unit) => unit.placement !== 'all')),
    main: text(units.filter((unit) => unit.placement === 'main')),
    units: units.map((unit) => unit.name),
  };
}

/**
 * The units a bot carries, in the order they go into its file: the kit's
 * defaults, then what the bots folder gives every bot, then the bot's own. A
 * unit named more than once is carried where it was named first, and `kit:review`
 * and `review` are two different units, not one named twice.
 */
function unitsFor(bots, bot) {
  const named = [
    ...kitDefaults(bots),
    ...listIn(path.join(bots, 'defaults.yaml')),
    ...asList(bot.rules, path.join(botDir(bots, bot.name), 'bot.yaml')),
  ];
  return [...new Set(named)].map((ref) => readUnit(bots, ref));
}

/** The kit's own units that every bot carries without anyone asking, in name order. */
function kitDefaults(bots) {
  return readdirSync(KIT_RULES)
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .map((entry) => `${KIT}${entry.slice(0, -'.md'.length)}`)
    .filter((ref) => readUnit(bots, ref).applies === 'all');
}

/** Where a name in a list points: the kit's shelf, or the user's own. */
const fileOf = (bots, ref) => (ref.startsWith(KIT)
  ? path.join(KIT_RULES, `${ref.slice(KIT.length)}.md`)
  : path.join(bots, 'rules', `${ref}.md`));

/**
 * Where a unit goes (R6): `all` in the instruction file only, `main` in a
 * Claude Code session's system text and not in the file it loads, `both` in
 * both, from one source.
 */
const PLACEMENTS = ['all', 'main', 'both'];

/** A unit file is frontmatter and then the rule. The compiler reads a title and a body. */
const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/;

/**
 * One unit, read. Every way this can go wrong names the file, because the way
 * out of all of them is to open it.
 */
function readUnit(bots, ref) {
  const file = fileOf(bots, ref);

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`${ref} names no rule unit: there is no ${file}.`);
  }

  const found = FRONTMATTER.exec(text);
  if (found === null) {
    throw new Error(`${file} is not a rule unit: it should open with a line ---, the title, a line ---, and then the rule.`);
  }

  let data;
  try {
    data = parse(found[1]);
  } catch (error) {
    throw new Error(`${file} has frontmatter that is not YAML: ${error.message}`);
  }

  const title = data?.title;
  if (typeof title !== 'string' || title.trim() === '') {
    throw new Error(`${file} has no title, and a unit is written into AGENTS.md under its title.`);
  }

  const placement = data.placement ?? 'all';
  if (!PLACEMENTS.includes(placement)) {
    throw new Error(`${file} has the placement ${JSON.stringify(data.placement)}, and a unit's placement is all, main or both. Fix it, then build again: nothing was built for this bot.`);
  }

  return {
    // The kit's units name themselves; one of the user's is named by its file.
    name: typeof data.name === 'string' ? data.name : path.basename(file, '.md'),
    title: title.trim(),
    body: (found[2] ?? '').trim(),
    applies: data.applies,
    placement,
  };
}

/**
 * A named list in one of the user's YAML files — `rules:` or `skills:` — out of
 * `defaults.yaml` or a `bot.yaml`. A file that is not there lists nothing.
 */
export function listIn(file, key = 'rules') {
  if (!existsSync(file)) return [];

  let doc;
  try {
    doc = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not readable as YAML, and the ${key} every bot gets are listed in it: ${error.message}`);
  }
  return asList(doc?.[key], file, key);
}

/** A list of names, or a plain refusal to guess at what else it might be. */
function asList(value, file, key = 'rules') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`the rules entry in ${file} is not a list of rule unit names.`);
  }

  return value.map((ref) => {
    if (typeof ref !== 'string' || ref.trim() === '') {
      throw new Error(`the ${key} list in ${file} holds ${JSON.stringify(ref)}, and an entry is a name: house, or kit:review.`);
    }
    return ref.trim();
  });
}

/** How many of a marker a file turned out to carry, in words that read. */
const markers = (count, what) => `${count} ${what} marker${count === 1 ? '' : 's'}`;

/**
 * The build's own block in `file` as it stands: where it begins, where it ends,
 * and what is between the markers. Undefined when the file holds none of it.
 *
 * Throws when what is there is not a block the build may write over — the wrong
 * number of markers, or text somebody typed in between them. Read-only, so the
 * health check asks the same question without writing anything.
 */
function blockIn(file, lines) {
  const begins = [];
  const ends = [];
  lines.forEach((line, at) => {
    if (line === END) ends.push(at);
    else if (line.startsWith('<!-- obk:rules')) begins.push(at);
  });

  if (begins.length === 0 && ends.length === 0) return undefined;

  if (begins.length !== 1 || ends.length !== 1 || begins[0] > ends[0]) {
    throw new Error(`${file} carries ${markers(begins.length, 'obk:rules begin')} and ${markers(ends.length, 'end')}, and the build needs one of each, the begin first. Put the markers back, or take the block out and let the build write a new one.`);
  }

  const was = lines.slice(begins[0] + 1, ends[0]).join('\n');
  const stamp = BEGIN.exec(lines[begins[0]]);
  if (stamp === null || stamp[1] !== checksum(was)) {
    throw new Error(`the obk:rules block in ${file} is not the one obk wrote, so nothing was written. Move what you added below the end marker, or put the block back as it was, then build again.`);
  }

  return { at: begins[0], to: ends[0], was };
}

/**
 * Put `body` between the markers in `file`, and leave the rest of it alone.
 * Returns 'built', or 'unchanged' when the file already says this.
 *
 * The file is worked on as lines and handed back as lines, so what the user
 * wrote outside the block comes back byte for byte, trailing spaces and all.
 */
function writeBlock(file, body) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = text.split('\n');
  const block = [beginLine(checksum(body)), ...body.split('\n'), END];
  const found = blockIn(file, lines);

  if (found === undefined) {
    // Nothing of the build's in the file: the block goes at the top and
    // everything that was there is kept below it.
    const rest = text === '' ? [''] : ['', ...lines];
    writeFileSync(file, [...block, ...rest].join('\n'));
    return 'built';
  }

  if (found.was === body) return 'unchanged';

  writeFileSync(file, [...lines.slice(0, found.at), ...block, ...lines.slice(found.to + 1)].join('\n'));
  return 'built';
}

/**
 * `CLAUDE.md` beside `AGENTS.md`, pointing at it: the one way Claude Code is
 * certain to read a bot's rules whatever else is set (tech notes, section 2,
 * and PRD 6.6). The link is relative, so it survives the bots repo being cloned
 * elsewhere.
 *
 * The link is made by asking for it, not by looking first and then asking: the
 * file system answers "there is already something there" in one step, and a
 * look followed by an act has a gap in the middle where another run of the kit
 * fits.
 *
 * Whatever is already there is the user's and stays. What the build owes them
 * is the fact they cannot see: Claude Code reads a `CLAUDE.md` *instead of*
 * `AGENTS.md`, so one that is not this bot's `AGENTS.md` leaves the two
 * harnesses starting from different rules, which is the one thing ADR 0013
 * says must not happen.
 *
 * Returns `{ linked }` on the run that made the link, `{ trouble }` when what
 * is there is not this bot's rules, and nothing at all when it is.
 */
function claudeMd(home, file) {
  const link = path.join(home, CLAUDE);

  try {
    symlinkSync(AGENTS, link);
    return { linked: link };
  } catch (error) {
    if (error.code !== 'EEXIST') {
      return { trouble: `${link} could not be linked to AGENTS.md (${error.message}), so Claude Code may not read this bot's rules.` };
    }
  }

  if (sameFile(link, file)) return {};
  // The kit's own built file, of a bot that no longer runs a Claude Code
  // session, goes back to the link.
  if (claudeState(link, file) === 'kit-file') {
    try {
      unlinkSync(link);
      symlinkSync(AGENTS, link);
      return { linked: link };
    } catch (error) {
      return { trouble: `${link} could not be linked to AGENTS.md (${error.message}), so Claude Code may not read this bot's rules.` };
    }
  }
  return { trouble: claudeMdTrouble(link) };
}

/**
 * The begin line of the block in a CLAUDE.md the kit built: the block's own
 * checksum, as in AGENTS.md, and a checksum of the whole file, taken with a
 * row of zeros in its own place. So the rest of the file stays AGENTS.md word
 * for word, and a hand edit anywhere in it is seen.
 */
const CLAUDE_BEGIN = /^<!-- obk:rules ([0-9a-f]{16}) file ([0-9a-f]{16}) .*-->$/;
const UNSUMMED = '0'.repeat(16);
const claudeBegin = (sum, whole) =>
  `<!-- obk:rules ${sum} file ${whole} — built by obk from AGENTS.md without the units placed main; write your own text in AGENTS.md, below the end marker. -->`;

/** Whether `text` is a CLAUDE.md the kit built and nobody changed since. */
function kitBuilt(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => CLAUDE_BEGIN.test(line));
  if (at < 0) return false;
  const [, , whole] = CLAUDE_BEGIN.exec(lines[at]);
  lines[at] = lines[at].replace(/^(<!-- obk:rules [0-9a-f]{16} file )[0-9a-f]{16}/, `$1${UNSUMMED}`);
  return whole === checksum(lines.join('\n'));
}

/**
 * What a Claude Code bot's CLAUDE.md should say: its AGENTS.md word for word,
 * with the kit's block holding `claude`, the block without the main units.
 */
function claudeText(agents, claude) {
  const lines = readFileSync(agents, 'utf8').split('\n');
  const found = blockIn(agents, lines);
  const before = found === undefined ? [] : lines.slice(0, found.at);
  const after = found === undefined ? lines : lines.slice(found.to + 1);
  const sum = checksum(claude);
  const text = (whole) => [...before, claudeBegin(sum, whole), ...claude.split('\n'), END, ...after].join('\n');
  return text(checksum(text(UNSUMMED)));
}

/** The same, or undefined when AGENTS.md cannot be read as the kit writes it. */
function claudeTextOrNone(agents, claude) {
  try {
    return claudeText(agents, claude);
  } catch {
    return undefined;
  }
}

/**
 * What is at CLAUDE.md now: nothing, the kit's link to AGENTS.md, a file the
 * kit built and nobody changed, or something of the user's.
 */
function claudeState(link, agents) {
  const stat = lstatSync(link, { throwIfNoEntry: false });
  if (stat === undefined) return 'absent';
  if (stat.isSymbolicLink()) return sameFile(link, agents) ? 'kit-link' : 'theirs';
  if (!stat.isFile()) return 'theirs';
  return kitBuilt(readFileSync(link, 'utf8')) ? 'kit-file' : 'theirs';
}

/** Why a CLAUDE.md the kit will not write matters, and what to do. */
const claudeConflict = (link) =>
  `${link} holds lines the kit did not write, so the kit leaves it as it is, and this bot's Claude sessions read it, not the rules built now. Move your lines into AGENTS.md, below the kit's block, and take them out of CLAUDE.md or delete it; the next build writes it again.`;

/**
 * Build a Claude Code bot's CLAUDE.md as a file (R6): the kit's link to
 * AGENTS.md is replaced, its own file is written again when the text changed,
 * and anything else is the user's and stays, named as a conflict.
 */
function claudeFile(home, agents, claude) {
  const link = path.join(home, CLAUDE);
  const wanted = claudeText(agents, claude);
  const state = claudeState(link, agents);
  if (state === 'theirs') return { trouble: claudeConflict(link) };
  if (state === 'kit-file' && readFileSync(link, 'utf8') === wanted) return {};
  try {
    refuseOutside(home, link);
    // Never written through the link: that would write into AGENTS.md.
    if (state === 'kit-link') unlinkSync(link);
    writeFileSync(link, wanted);
  } catch (error) {
    return { trouble: `${link} could not be written (${error.message}), so this bot's Claude sessions may not read its rules.` };
  }
  return { claudeBuilt: link };
}

/** The file of a Claude Code bot's system text, named by a checksum of `text`. */
export const systemFileOf = (bots, name, text) => path.join(kitFolders(bots, name).prompts, `system-${checksum(text)}.md`);

/** The checksum a system file's name carries. */
const SYSTEM_NAME = /^system-([0-9a-f]{16})\.md$/;

/**
 * Write the bot's system text where its launch line names it, and take away
 * its older files that no entry of its book names (R6).
 */
function writeSystem(bots, home, name, text) {
  if (text === '') return {};
  const file = systemFileOf(bots, name, text);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
  } catch (error) {
    return { trouble: `${file} could not be written (${error.message}), so this bot's CLAUDE.md keeps every unit, and its Claude sessions start with no appended system text; the kit's hook gives them the main units as context.` };
  }
  // The kit's own copy, for a launch when the units cannot be built. One that
  // cannot be written leaves the older copy, which is still the kit's text.
  try {
    keepSystemText(bots, name, text);
  } catch {
    // The file the line names is written; only the fallback is older.
  }
  // A book that cannot be read may name any of them: then none is removed.
  const named = namedSystems(home);
  if (named === undefined) return { system: file };
  const kept = new Set([path.basename(file), ...named]);
  for (const entry of namesOf(path.dirname(file))) {
    if (SYSTEM_NAME.test(entry) && !kept.has(entry)) rmSync(path.join(path.dirname(file), entry), { force: true });
  }
  return { system: file };
}

/**
 * The system files the book's entries name, by file name, or undefined when
 * the book is there but cannot be read.
 */
function namedSystems(home) {
  try {
    return Object.values(readBook(home).sessions ?? {})
      .map((entry) => entry?.system)
      .filter((name) => typeof name === 'string' && SYSTEM_NAME.test(name));
  } catch {
    return undefined;
  }
}

/** Every system file of the bot `name`, as its retire removes them. */
export function systemFilesOf(bots, name) {
  const dir = kitFolders(bots, name).prompts;
  return namesOf(dir).filter((entry) => SYSTEM_NAME.test(entry)).map((entry) => path.join(dir, entry));
}

/**
 * The system files of the bot `name` that the kit keeps: its current one and
 * every one a book entry names. Health calls none of them a leftover.
 */
export function systemFilesKept(bots, home, bot) {
  const dir = kitFolders(bots, bot.name).prompts;
  // A book that cannot be read may name any of them: then all are kept.
  const named = namedSystems(home) ?? namesOf(dir).filter((name) => SYSTEM_NAME.test(name));
  const kept = named.map((name) => path.join(dir, name));
  try {
    const { system } = blockFor(bots, bot);
    if (system !== '') kept.push(systemFileOf(bots, bot.name, system));
  } catch {
    // A bot whose units cannot be read keeps what its book names.
  }
  return kept;
}

/**
 * The system file a Claude Code session of this bot is launched with: the
 * current one, when the build wrote it. When its units cannot be built now (a
 * build that failed leaves the older CLAUDE.md in place), the last one the
 * build wrote, from the kit's own copy, so that the session still has its
 * main units. None when
 * the current one could not be written (CLAUDE.md then keeps every unit) or
 * there is none, and the kit's hook then gives the main units as context.
 */
export function currentSystemFile(bots, bot) {
  let system;
  try {
    ({ system } = blockFor(bots, bot));
  } catch {
    return lastSystemFile(bots, bot.name);
  }
  if (system === '') return undefined;
  const file = systemFileOf(bots, bot.name, system);
  return existsSync(file) ? file : undefined;
}

/**
 * The kit's own copy of the bot's last system text, in the bot's main text
 * folder, which no launch line names. The prompts folder, where the system
 * file the line names is, may be written by a Codex session of the bot, so a
 * file there is never taken on its own word: when the units cannot be built
 * now, the kit's copy is what the session gets.
 */
const keptSystemPath = (bots, name) => path.join(claudeTextFolder(bots, name), 'system.md');

function keepSystemText(bots, name, text) {
  const file = keptSystemPath(bots, name);
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
}

/** The kit's copy of the bot's last system text, or undefined. */
function keptSystemText(bots, name) {
  try {
    const text = readFileSync(keptSystemPath(bots, name), 'utf8');
    return text === '' ? undefined : text;
  } catch {
    return undefined;
  }
}

/**
 * The system file of the bot's last system text, written again from the kit's
 * copy, so that what the line names is the kit's text. Undefined with no copy,
 * or when the file cannot be written.
 */
function lastSystemFile(bots, name) {
  const text = keptSystemText(bots, name);
  if (text === undefined) return undefined;
  const file = systemFileOf(bots, name, text);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
  } catch {
    return undefined;
  }
  return file;
}

/**
 * The text the kit's hook gives a Claude Code session whose launch line
 * appends nothing: the bot's main units, or, when its units cannot be built
 * now, the text of its newest system file.
 */
export function guardText(bots, bot) {
  try {
    return blockFor(bots, bot).main;
  } catch {
    return keptSystemText(bots, bot.name);
  }
}

/** The names in a folder; none when it cannot be read. */
function namesOf(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * The sessions of the bot whose system text is older than its units, and the
 * sessions noted as launched with no appended text: one sentence for each.
 */
export function systemTrouble(bots, home, bot) {
  if (!isClaudeBot(bot)) return [];
  let book;
  let current;
  try {
    book = readBook(home);
    const { system } = blockFor(bots, bot);
    current = system === '' ? undefined : `system-${checksum(system)}.md`;
  } catch {
    return [];
  }
  return Object.entries(book.sessions ?? {}).flatMap(([session, entry]) => {
    const said = [];
    if (entry?.bare === true) {
      said.push(`${bot.name}/${session} runs with no appended system text: its launch line has no --append-system-prompt-file, as after Orca's own resume of a tab. The kit's hook gives it its main units as context; obk restart ends this.`);
    } else if (typeof entry?.system === 'string' && current !== undefined && entry.system !== current) {
      said.push(`${bot.name}/${session}'s system text is older than its bot's units: it came from ${path.join(kitFolders(bots, bot.name).prompts, path.basename(entry.system))}. It gets the new text after a restart and its next compaction.`);
    }
    return said;
  });
}

/** Why a `CLAUDE.md` that is not this bot's `AGENTS.md` matters, in one sentence. */
const claudeMdTrouble = (link) =>
  `${link} is not this bot's AGENTS.md, and Claude Code reads it in place of one, so a Claude session and a Codex session here would start from different rules. Point it at AGENTS.md, or move it aside and let the build link it.`;

/**
 * What is wrong with a bot's rules as they stand: `[{ where, says }]`, and
 * nothing when they are in order. The health check's half of the build — it
 * asks the same questions and writes nothing at all, so a file the build would
 * refuse is reported rather than put right (PRD 6.8).
 *
 * A file with no obk block in it is not trouble. That is a bot whose owner
 * wrote its instructions by hand, which the build leaves alone as well.
 */
export function agentsTrouble(bots, home, bot) {
  const file = path.join(home, AGENTS);
  const trouble = [];

  // What the charter and the rule units say now. It is a check of its own — a
  // list naming a unit that is not there — and it is what the file is held
  // against below.
  let built;
  try {
    built = blockFor(bots, bot);
  } catch (error) {
    trouble.push({ where: file, says: error.message });
  }

  if (!existsSync(file)) {
    trouble.push({
      where: file,
      says: `there is no ${file}, so this bot has no instructions: obk up does not start a bot's sessions without them. obk rules build writes the file.`,
    });
    return trouble;
  }

  const text = readFileSync(file, 'utf8');
  try {
    const found = blockIn(file, text.split('\n'));
    if (found !== undefined && built !== undefined && found.was !== built.body) {
      trouble.push({
        where: file,
        says: `${file} is not what ${bot.name}'s charter and rule units say now, so its sessions are reading the older text. obk rules build writes it, and obk up does too before it starts a session.`,
      });
    }
  } catch (error) {
    trouble.push({ where: file, says: error.message });
  }

  // Codex reads no more than this of an instructions file, and says nothing
  // when it stops reading (tech notes, section 3).
  if (Buffer.byteLength(text) > CODEX_CAP) {
    trouble.push({
      where: file,
      says: `${file} is over the ${CODEX_CAP / 1024} KiB Codex reads, so a Codex session will not see all of it.`,
    });
  }

  // A link that leads nowhere is still a CLAUDE.md in Claude Code's way, so the
  // question is whether there is an entry at all, not whether it resolves —
  // and a bot with none is not in the state the kit keeps its bots in either.
  // Claude Code reads AGENTS.md directly when there is no CLAUDE.md anywhere
  // above the folder, and not on Bedrock or with telemetry off (tech notes,
  // section 2); the link is what makes it certain, which is why the build makes
  // one (PRD 6.6).
  const link = path.join(home, CLAUDE);
  if (isClaudeBot(bot) && built !== undefined) {
    const state = claudeState(link, file);
    if (state === 'theirs') {
      trouble.push({ where: link, says: claudeConflict(link) });
    } else if (state !== 'kit-file' || readFileSync(link, 'utf8') !== claudeTextOrNone(file, built.claude)) {
      trouble.push({
        where: link,
        says: `${link} is not this bot's AGENTS.md without its main units, so its Claude sessions read older text. obk rules build writes it, and obk up does too before it starts a session.`,
      });
    }
    return trouble;
  }
  if (lstatSync(link, { throwIfNoEntry: false }) === undefined) {
    trouble.push({
      where: link,
      says: `there is no ${link}. The kit keeps one there as a link to this bot's instructions, because it is the one way Claude Code is certain to read them whatever else is set. obk rules build makes it.`,
    });
  } else if (!sameFile(link, file)) {
    trouble.push({ where: link, says: claudeMdTrouble(link) });
  }

  return trouble;
}

/** Whether two paths are the same file in the end. One that leads nowhere is not. */
function sameFile(one, other) {
  try {
    // Native, as in leadsOutside: the JS one takes `hop/..` away before `hop`
    // is followed.
    return realpathSync.native(one) === realpathSync.native(other);
  } catch {
    return false;
  }
}

/**
 * A stamp of a bot's `AGENTS.md` as it is now, or undefined when there is none
 * to read. It is what a session read when it started, noted in the book at that
 * moment, so that health can tell a session running on older rules from one on
 * the current ones. The whole file, not only the build's block: what the user
 * wrote below the end marker is part of what the session reads.
 */
export function rulesStamp(home) {
  try {
    return checksum(readFileSync(path.join(home, AGENTS), 'utf8'));
  } catch {
    return undefined;
  }
}
