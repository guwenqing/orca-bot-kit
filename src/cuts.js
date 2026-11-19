// The tools and built-in skills a Claude Code session of a fleet goes without
// (request claude-session-trim, R1 and R2; ADR 0055, section 2).
//
// A tool's cut is a `permissions.deny` entry with its name, and a skill's cut
// is "off" under `skillOverrides`, both in the bot's own
// `.claude/settings.json`, where the kit already writes its hook. Claude Code
// then leaves the tool's or skill's text out of what it sends.
//
// The kit owns only the entries of names in its lists: it writes the cut of
// each name that a list cuts, and takes the kit's entry out for each name the
// bot keeps. Every other entry of the file stays as the user wrote it.
//
// The kit found no way to ask Claude Code which tools and skills it knows, so
// health goes by the fleet's own Claude Code records: each conversation's
// record lists the tools and skills that it had.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

import { botDir, botNames, readBot } from './bot.js';
import { transcriptsIn } from './conversations.js';
import { readSettings } from './hooks.js';
import { harnessOf } from './launch.js';
import { eachLine } from './lines.js';
import { readRecipe } from './main-text.js';

/** R1's tools. */
export const DEFAULT_TOOLS = ['Artifact', 'ArtifactComments', 'ArtifactData', 'DesignSync'];

/** R1's built-in skills. */
export const DEFAULT_SKILLS = [
  'artifact-design',
  'artifact-diagramming',
  'artifact-capabilities',
  'update-config',
  'fewer-permission-prompts',
  'init',
  'keybindings-help',
  'plugin-authoring',
];

/** R1's units of the main text, which the kit cuts when it builds that text (R5). */
export const DEFAULT_TEXT = ['text:ultrareview', 'text:product-channels', 'text:fast-mode', 'text:no-planning-documents', 'text:drop-old-cautions'];

/** A unit of the main text, which the kit cuts only when it builds that text (R5). */
const TEXT = 'text:';

/**
 * The tools and skills that go together or stay together (R2). Without the
 * Workflow skill, Claude Code puts the skill's text into the tool's
 * description. The Artifact tool's text tells the session to load its skills
 * and names its two other tools (#781).
 */
const TOGETHER = [
  ['Workflow', 'workflow-authoring'],
  ['Artifact', 'ArtifactComments', 'ArtifactData', 'artifact-design', 'artifact-capabilities'],
];

/** A tool's name starts with a capital, or is an MCP server's tool. */
const isTool = (name) => /^[A-Z]/.test(name) || name.startsWith('mcp__');
const isText = (name) => name.startsWith(TEXT);

/** The kinds of record line that list names, looked for before a line is parsed. */
const LISTING = ['"skill_listing"', '"deferred_tools_delta"', '"api-request-shape"'];

/** The bot's own Claude Code settings, beside its hook. */
const SETTINGS = '.claude/settings.json';

/**
 * The names in the list `key` of the YAML file `file`; none when the file or
 * the list is not there. A list that is not a list of names is refused.
 */
function namesIn(file, key) {
  if (!existsSync(file)) return [];
  let doc;
  try {
    doc = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not readable as YAML, and the kit reads the ${key} list in it: ${error.message}`);
  }
  const value = doc?.[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || name.trim() === '')) {
    throw new Error(`the ${key} list in ${file} is not a list of names, such as WebFetch, init or text:fast-mode. Fix it, then run the command again.`);
  }
  return value.map((name) => name.trim());
}

/** The names, with the others of each name's group added, each once. */
const together = (names) => [...new Set(names.flatMap((name) => TOGETHER.find((group) => group.includes(name)) ?? [name]))];

/**
 * What the bot at `home` cuts and keeps: the tools and skills to cut, the
 * tools and skills it keeps, the names a user's list cuts beyond the default
 * ones, the `text:` units it cuts (the default ones and the user's, less its
 * keeps), and every `text:` name its lists hold.
 */
export function cutsOf(bots, home) {
  const own = path.join(home, 'bot.yaml');
  const userCut = [...namesIn(path.join(bots, 'defaults.yaml'), 'claude_cut'), ...namesIn(own, 'claude_cut')];
  const keep = together(namesIn(own, 'claude_keep'));
  const cut = together([...DEFAULT_TOOLS, ...DEFAULT_SKILLS, ...userCut]).filter((name) => !keep.includes(name));
  const named = (names) => names.filter((name) => !isText(name));
  return {
    tools: named(cut).filter(isTool),
    skills: named(cut).filter((name) => !isTool(name)),
    kept: named(keep),
    added: named(together(userCut)).filter((name) => !keep.includes(name) && !DEFAULT_TOOLS.includes(name) && !DEFAULT_SKILLS.includes(name)),
    text: [...new Set([...DEFAULT_TEXT, ...userCut.filter(isText)])].filter((name) => !keep.includes(name)),
    textNamed: [...new Set([...userCut, ...keep].filter(isText))],
  };
}

/**
 * The Claude Code settings `settings`, read from `file`, with the cuts
 * `cuts` written in and the kit's entries of kept names taken out. Every other
 * entry stays where it was.
 */
export function withCuts(settings, cuts, file) {
  const permissions = settings.permissions ?? {};
  if (permissions === null || typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new Error(`${file} has a permissions entry that is not a mapping, and the kit writes the tools it cuts in there. Fix it or move it aside, then run the command again.`);
  }
  const deny = permissions.deny ?? [];
  if (!Array.isArray(deny)) {
    throw new Error(`${file} has a permissions.deny entry that is not a list, and the kit writes the tools it cuts in there. Fix it or move it aside, then run the command again.`);
  }
  const overrides = settings.skillOverrides ?? {};
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error(`${file} has a skillOverrides entry that is not a mapping of skill names, and the kit turns off the skills it cuts in there. Fix it or move it aside, then run the command again.`);
  }

  const kept = deny.filter((entry) => !cuts.kept.includes(entry));
  const denied = [...kept, ...cuts.tools.filter((tool) => !kept.includes(tool))];
  const skills = Object.fromEntries(Object.entries(overrides).filter(([name, value]) => !(cuts.kept.includes(name) && value === 'off')));
  for (const skill of cuts.skills) skills[skill] = 'off';

  const wanted = { ...settings, skillOverrides: skills };
  if (denied.length > 0 || permissions.deny !== undefined) wanted.permissions = { ...permissions, deny: denied };
  return wanted;
}

/**
 * Health's findings on the cuts of the bot `bot` at `home`: a cut the file
 * lacks, a kept name the file still cuts, a `text:` name, and names that the
 * fleet's records do not show. Only for a bot with a Claude Code session.
 */
export function cutsTrouble(bots, home, bot) {
  if (!bot.sessions.some((session) => harnessOf(session, bot.harness) === 'claude')) return [];
  const file = path.join(home, SETTINGS);
  let cuts;
  try {
    cuts = cutsOf(bots, home);
  } catch (error) {
    return [{ where: path.join(home, 'bot.yaml'), says: error.message }];
  }

  // A text: name the recipe does not know cuts nothing (R2).
  const recipe = readRecipe();
  const known = new Set((recipe?.units ?? []).map((unit) => unit.name));
  // A part that Claude Code adds by itself is out of the kit's text whatever a
  // list says, and the session gets it from Claude Code (ADR 0061).
  const back = new Set((recipe?.back ?? []).map((unit) => unit.name));
  const found = cuts.textNamed.filter((name) => !known.has(name)).map((name) => ({
    where: path.join(home, 'bot.yaml'),
    says: back.has(name)
      ? `${bot.name}'s cut or keep lists name ${name}, a part that Claude Code adds by itself after the kit's main text, so a list does not change it. The session gets it from Claude Code while it has the part's tool.`
      : `${bot.name}'s cut or keep lists name ${name}, which the kit's recipe of Claude Code's main text does not know, so it changes nothing. Check the name.`,
  }));

  // A file that is not there or cannot be read is the hook's check to name.
  let settings;
  try {
    settings = existsSync(file) ? readSettings(file, 'the tools and skills the kit cuts') : undefined;
  } catch {
    settings = undefined;
  }
  if (settings !== undefined) {
    const deny = Array.isArray(settings.permissions?.deny) ? settings.permissions.deny : [];
    const overrides = settings.skillOverrides !== null && typeof settings.skillOverrides === 'object' ? settings.skillOverrides : {};
    const lacking = [...cuts.tools.filter((tool) => !deny.includes(tool)), ...cuts.skills.filter((skill) => overrides[skill] !== 'off')];
    if (lacking.length > 0) {
      found.push({ where: file, says: `${file} does not cut ${lacking.join(', ')}, so ${bot.name}'s Claude Code sessions get ${lacking.length === 1 ? 'it' : 'them'}. obk up writes the cuts.` });
    }
    const stillCut = cuts.kept.filter((name) => deny.includes(name) || overrides[name] === 'off');
    if (stillCut.length > 0) {
      found.push({ where: file, says: `${file} still cuts ${stillCut.join(', ')}, which ${bot.name}'s claude_keep list keeps. obk up takes the cut out.` });
    }
  }

  // Names against the records.
  if (cuts.added.length > 0) {
    const seen = fleetNames(bots, cuts.added);
    for (const name of cuts.added.filter((one) => !seen.has(one))) {
      found.push({
        where: path.join(home, 'bot.yaml'),
        says: `${bot.name} cuts ${name}, which is not seen in any Claude Code record of this fleet. Check the name: the kit found no way to ask Claude Code which names it knows.`,
      });
    }
  }
  if (cuts.kept.length > 0) {
    const newest = transcriptsIn('claude', home).filter((one) => !one.subagent).at(-1);
    if (newest !== undefined) {
      const held = namesOf(newest.file, cuts.kept);
      const before = settingsWrittenAfter(file, newest.at);
      for (const name of cuts.kept.filter((one) => !held.has(one))) {
        found.push({
          where: path.join(home, 'bot.yaml'),
          says: `${bot.name} keeps ${name}, which is not in the newest Claude Code record of ${bot.name}.${before ? ' That record is older than the bot\'s settings: start the session again, then look again.' : ' Check the name: the kit found no way to ask Claude Code which names it knows.'}`,
        });
      }
    }
  }
  return found;
}

/** Whether the bot's settings file was written after the moment `at`. */
function settingsWrittenAfter(file, at) {
  try {
    return statSync(file).mtimeMs > Date.parse(at);
  } catch {
    return false;
  }
}

/**
 * The names of `wanted` that the Claude Code records of every bot of the fleet
 * hold. Each record is read whole, and the reading stops once every name is
 * seen: a fleet's records ran to 7 GB on this machine.
 */
function fleetNames(bots, wanted) {
  const seen = new Set();
  for (const name of botNames(bots)) {
    if (wanted.every((one) => seen.has(one))) break;
    let home;
    try {
      home = botDir(bots, name);
      readBot(home, name);
    } catch {
      continue;
    }
    for (const one of transcriptsIn('claude', home)) {
      if (wanted.every((want) => seen.has(want))) break;
      for (const held of namesOf(one.file, wanted.filter((want) => !seen.has(want)))) seen.add(held);
    }
  }
  return seen;
}

/**
 * The names of `wanted` that one conversation's record lists, anywhere in it.
 * The reading stops once every name is found.
 */
function namesOf(file, wanted) {
  const names = new Set();
  if (wanted.length === 0) return names;
  try {
    eachLine(file, (line) => {
      if (line === undefined || !LISTING.some((kind) => line.includes(kind))) return false;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        return false;
      }
      for (const name of listed(record)) if (wanted.includes(name)) names.add(name);
      return wanted.every((want) => names.has(want));
    });
  } catch {
    // An unreadable record shows no names.
  }
  return names;

  function listed(record) {
    const attachment = record?.type === 'attachment' ? record.attachment : undefined;
    const list = attachment?.type === 'skill_listing' ? attachment.names
      : attachment?.type === 'deferred_tools_delta' ? attachment.addedNames
        : record?.type === 'api-request-shape' && Array.isArray(record.shape?.tools) ? record.shape.tools.map((tool) => tool?.name)
          : undefined;
    return Array.isArray(list) ? list.filter((name) => typeof name === 'string') : [];
  }
}
