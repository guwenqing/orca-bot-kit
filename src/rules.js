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
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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

  return { bot: bot.name, file, state, units: built.units, bytes: statSync(file).size, ...claudeMd(home, file) };
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
 * harnesses starting from different rules, which is the one thing ADR 0003
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
  return { trouble: claudeMdTrouble(link) };
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
  // question is whether there is an entry at all, not whether it resolves.
  const link = path.join(home, CLAUDE);
  if (lstatSync(link, { throwIfNoEntry: false }) !== undefined && !sameFile(link, file)) {
    trouble.push({ where: link, says: claudeMdTrouble(link) });
  }

  return trouble;
}

/** Whether two paths are the same file in the end. One that leads nowhere is not. */
function sameFile(one, other) {
  try {
    return realpathSync(one) === realpathSync(other);
  } catch {
    return false;
  }
}
