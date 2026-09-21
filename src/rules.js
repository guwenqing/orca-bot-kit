// A bot's `AGENTS.md`, built from its charter and the rule units it carries
// (PRD 6.6, ADR 0003).
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
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { botDir, botNames, displayName, readBot } from './bot.js';

/** The kit's own units, inside the installed package. */
const KIT_RULES = fileURLToPath(new URL('../rules', import.meta.url));

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
 */
export function buildAgents(bots, home, bot) {
  const file = path.join(home, AGENTS);

  let built;
  try {
    built = blockFor(bots, bot);
  } catch (error) {
    return { bot: bot.name, file, state: 'failed', trouble: error.message };
  }

  let state;
  try {
    state = writeBlock(file, built.body);
  } catch (error) {
    return { bot: bot.name, file, state: 'conflict', trouble: error.message };
  }

  const linked = linkClaudeMd(home);
  return { bot: bot.name, file, state, units: built.units, bytes: statSync(file).size, ...linked };
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
    try {
      return buildAgents(bots, home, readBot(home, name));
    } catch (error) {
      // A `bot.yaml` the kit cannot read at all. Same answer as a list it
      // cannot follow: this bot is not built, and nothing else changes.
      return { bot: name, file: path.join(home, AGENTS), state: 'failed', trouble: error.message };
    }
  });
}

/**
 * What the block should hold: the bot's name, its charter, and every unit it
 * carries under its own title. Returns the text and the unit names in the order
 * they were written.
 */
export function blockFor(bots, bot) {
  const units = unitsFor(bots, bot);
  const parts = [`# ${displayName(bot.name)}`];

  const charter = typeof bot.charter === 'string' ? bot.charter.trim() : '';
  if (charter !== '') parts.push('## Charter', charter);
  for (const unit of units) parts.push(`## ${unit.title}`, unit.body);

  return { body: parts.join('\n\n'), units: units.map((unit) => unit.name) };
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

  return {
    // The kit's units name themselves; one of the user's is named by its file.
    name: typeof data.name === 'string' ? data.name : path.basename(file, '.md'),
    title: title.trim(),
    body: (found[2] ?? '').trim(),
    applies: data.applies,
  };
}

/** The `rules:` list in one of the user's YAML files. A file that is not there lists nothing. */
function listIn(file) {
  if (!existsSync(file)) return [];

  let doc;
  try {
    doc = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not readable as YAML, and the rules every bot gets are listed in it: ${error.message}`);
  }
  return asList(doc?.rules, file);
}

/** A list of unit names, or a plain refusal to guess at what else it might be. */
function asList(value, file) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`the rules entry in ${file} is not a list of rule unit names.`);
  }

  return value.map((ref) => {
    if (typeof ref !== 'string' || ref.trim() === '') {
      throw new Error(`the rules list in ${file} holds ${JSON.stringify(ref)}, and a unit is named by a name: house, or kit:review.`);
    }
    return ref.trim();
  });
}

/** How many of a marker a file turned out to carry, in words that read. */
const markers = (count, what) => `${count} ${what} marker${count === 1 ? '' : 's'}`;

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

  const begins = [];
  const ends = [];
  lines.forEach((line, at) => {
    if (line === END) ends.push(at);
    else if (line.startsWith('<!-- obk:rules')) begins.push(at);
  });

  const block = [beginLine(checksum(body)), ...body.split('\n'), END];

  if (begins.length === 0 && ends.length === 0) {
    // Nothing of the build's in the file: the block goes at the top and
    // everything that was there is kept below it.
    const rest = text === '' ? [''] : ['', ...lines];
    writeFileSync(file, [...block, ...rest].join('\n'));
    return 'built';
  }

  if (begins.length !== 1 || ends.length !== 1 || begins[0] > ends[0]) {
    throw new Error(`${file} carries ${markers(begins.length, 'obk:rules begin')} and ${markers(ends.length, 'end')}, and the build needs one of each, the begin first. Put the markers back, or take the block out and let the build write a new one.`);
  }

  const was = lines.slice(begins[0] + 1, ends[0]).join('\n');
  const stamp = BEGIN.exec(lines[begins[0]]);
  if (stamp === null || stamp[1] !== checksum(was)) {
    throw new Error(`the obk:rules block in ${file} is not the one obk wrote, so nothing was written. Move what you added below the end marker, or put the block back as it was, then build again.`);
  }

  if (was === body) return 'unchanged';

  writeFileSync(file, [...lines.slice(0, begins[0]), ...block, ...lines.slice(ends[0] + 1)].join('\n'));
  return 'built';
}

/**
 * `CLAUDE.md` beside `AGENTS.md`, pointing at it: the one way Claude Code is
 * certain to read a bot's rules whatever else is set (tech notes, section 2,
 * and PRD 6.6). The link is relative, so it survives the bots repo being cloned
 * elsewhere. Anything already at that name is the user's and is left as it is.
 *
 * Returns `{ linked }` on the run that made it, so the command that made a bot
 * can name every file it wrote, and nothing on the runs after.
 */
function linkClaudeMd(home) {
  const link = path.join(home, CLAUDE);
  if (lstatSync(link, { throwIfNoEntry: false }) !== undefined) return {};

  symlinkSync(AGENTS, link);
  return { linked: link };
}
