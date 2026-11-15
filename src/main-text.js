// Part 1: the main system text that the kit builds for a Claude Code session
// (request claude-session-trim, R5; ADR 0055, section 4).
//
// The kit ships no word of Claude Code's text. Claude Code records the main
// text each conversation runs on, as a list of sections, in the conversation's
// own transcript (a `prompt_snapshot` attachment). The kit reads it from the
// bot's own transcripts, keeps a copy outside the bots repo, and cuts the
// units that its recipe names by a hash of their text: a whole section, or one
// line of a section. A unit that the recipe does not name stays, so a new
// Claude Code version keeps every part that the recipe does not know yet.
//
// Only Claude Code's own main text is a source. The kit's hook notes a
// conversation that started or cleared on the kit's own launch line with no
// system text on it but the kit's appended file (record.js). The kit reads the
// first record of a noted conversation only, and takes the appended section
// out after it checks it by its sum.
//
// A saved original fits only a launch that is the same as the one it was
// recorded under: the same Claude Code version, the same launch words that do
// not change from one conversation to the next, and the same tool and skill
// cuts. A flag, a model or a tool cut changes the main text, so a source of
// another launch could give a session a text that its tools do not match.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { claudeTranscript } from './conversations.js';
import { readBook } from './book.js';
import { cutsOf } from './cuts.js';
import { harnessOf, kitFolders, launchShape, setsSettings } from './launch.js';
import { eachLine } from './lines.js';
import { physicalMemoryFolder } from './memory.js';

/** The recipe, beside this file. */
const RECIPE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'claude-text-recipe.json');

/** The sha256 of a unit's text as it stands, in hex. */
export const unitHash = (text) => createHash('sha256').update(text).digest('hex');

/** The short sum a kit file's name carries. */
const checksum = (text) => unitHash(text).slice(0, 16);

/** A kit main file's name. */
const MAIN_NAME = /^main-[0-9a-f]{16}\.md$/;

/** An id that is safe as a file name. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The main text from the sections of an original: the recipe's drop units
 * out, and each unit that `cut` names out, as a whole section or as one line
 * of a section. Every other section and line stays, in its order. The rest is
 * joined with a blank line, as Claude Code joins the sections it sends.
 * `found` holds the cut names it found, `missing` the cut names of the recipe
 * it did not find. The sections given are not changed.
 */
export function buildMainText(sections, { recipe, cut }) {
  const drop = new Set(recipe.drop.map((entry) => entry.hash));
  const named = new Map(recipe.units.filter((unit) => cut.includes(unit.name)).map((unit) => [unit.hash, unit.name]));
  const found = [];
  const seen = (name) => {
    if (!found.includes(name)) found.push(name);
  };

  const kept = [];
  for (const section of sections) {
    const whole = unitHash(section);
    if (drop.has(whole)) continue;
    if (named.has(whole)) {
      seen(named.get(whole));
      continue;
    }
    const lines = section.split('\n').filter((line) => {
      const one = unitHash(line);
      if (drop.has(one)) return false;
      if (!named.has(one)) return true;
      seen(named.get(one));
      return false;
    });
    if (lines.length > 0) kept.push(lines.join('\n'));
  }
  const known = new Set(named.values());
  const missing = cut.filter((name) => known.has(name) && !found.includes(name));
  return { text: kept.join('\n\n'), found, missing };
}

/** The kit's recipe, or undefined when it cannot be read. */
export function readRecipe() {
  try {
    const recipe = JSON.parse(readFileSync(RECIPE_FILE, 'utf8'));
    return Array.isArray(recipe?.drop) && Array.isArray(recipe?.units) ? recipe : undefined;
  } catch {
    return undefined;
  }
}

let version;

/**
 * The installed Claude Code's version, as `claude --version` gives it:
 * `{ version }`, or `{ why }` when it gives none. Asked once a run.
 */
export function claudeVersion() {
  if (version !== undefined) return version;
  const ran = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 20_000 });
  const number = ran.error === undefined && ran.status === 0 ? /^\s*(\d+\.\d+\.\d+)/.exec(ran.stdout ?? '') : null;
  version = number === null
    ? { why: 'the kit could not tell the installed Claude Code version: claude --version gave none' }
    : { version: number[1] };
  return version;
}

/** The kit's folders for the bot's main text, in its prompts folder beside the bots repo. */
export const textFolders = (prompts) => ({
  sources: path.join(prompts, 'sources'),
  originals: path.join(prompts, 'originals'),
});

/** The bot's main files, by name. */
export const mainFilesIn = (prompts) => namesIn(prompts).filter((name) => MAIN_NAME.test(name));

/**
 * Note the conversation `id` as a source, under the launch shape `shape`, with
 * the name of the kit's appended file its line carried (or null for none).
 * Called by the hook on a start or a clear only.
 */
export function noteSource(prompts, id, { shape, appended }) {
  if (typeof id !== 'string' || !SAFE_ID.test(id) || typeof shape !== 'string') return;
  const { sources } = textFolders(prompts);
  mkdirSync(sources, { recursive: true });
  writeFileSync(path.join(sources, `${id}.json`), `${JSON.stringify({ conversation: id, shape, appended: appended ?? null, at: new Date().toISOString() })}\n`);
}

/**
 * The text cuts of the bot at `home`: the kit's default `text:` units, and the
 * user's, less the bot's keeps.
 */
const textCutsOf = (bots, home) => cutsOf(bots, home).text;

/**
 * The bot's main text for a launch of shape `shape`: `{ file, text }` when the
 * kit can build it, or `{ why }` when the session runs on Claude Code's own
 * main text. With `write`, the original is saved, the notes it came from go,
 * and the main file is written; without it, nothing is written (health).
 */
export function mainTextFor(bots, home, prompts, shape, { write = true } = {}) {
  const recipe = readRecipe();
  if (recipe === undefined) return { why: 'the kit\'s recipe could not be read' };
  if (typeof shape !== 'string') return { why: 'the kit has not launched it with a launch it can match yet' };

  const { sources, originals } = textFolders(prompts);
  // Without a note or a saved original nothing can fit, and Claude Code is not asked.
  if (namesIn(sources).length === 0 && namesIn(originals).length === 0) {
    return { why: 'no conversation of the bot started on the kit\'s line is on record yet: its next start records one, and the start after it gets the kit\'s text' };
  }
  const installed = claudeVersion();
  if (installed.version === undefined) return { why: installed.why };

  const original = originalFor(home, prompts, shape, installed.version, write);
  if (original === undefined) {
    return {
      why: `no conversation of Claude Code ${installed.version} with this session's launch is on record yet: its next start records one, and the start after it gets the kit's text`,
      version: installed.version,
    };
  }

  let cut;
  try {
    cut = textCutsOf(bots, home);
  } catch (error) {
    return { why: error.message };
  }
  const built = buildMainText(original.sections, { recipe, cut });
  const file = path.join(prompts, `main-${checksum(built.text)}.md`);
  if (write) {
    mkdirSync(prompts, { recursive: true });
    if (!existsSync(file) || readFileSync(file, 'utf8') !== built.text) writeFileSync(file, built.text);
  }
  return { file, text: built.text, version: installed.version };
}

/**
 * The saved original for the shape and version, or one read from the newest
 * noted conversation that fits, saved when `write` is set. Undefined when
 * none fits.
 */
function originalFor(home, prompts, shape, version, write) {
  const { sources, originals } = textFolders(prompts);
  const saved = path.join(originals, `${version}-${shape}.json`);
  const kept = readJson(saved);
  if (Array.isArray(kept?.sections) && kept.sections.every((one) => typeof one === 'string')) return kept;

  let real;
  try {
    real = realpathSync(home);
  } catch {
    return undefined;
  }
  const notes = namesIn(sources)
    .map((name) => readJson(path.join(sources, name)))
    .filter((note) => note?.shape === shape && typeof note.conversation === 'string' && SAFE_ID.test(note.conversation))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  for (const note of notes) {
    const record = firstRecord(claudeTranscript(real, note.conversation));
    if (record === undefined || record.version !== version) continue;
    const sections = withoutAppended(record.sections, note.appended);
    if (sections === undefined) continue;
    const original = { version, shape, model: record.model ?? null, conversation: note.conversation, sections };
    if (write) save(prompts, saved, original, shape);
    return original;
  }
  return undefined;
}

/**
 * The sections without the kit's appended one: the last section, when its sum
 * is the one in the appended file's name. Undefined when the last section is
 * not that text. A conversation noted with no appended file gives every section.
 */
function withoutAppended(sections, appended) {
  if (appended === null || appended === undefined) return sections;
  const sum = /^system-([0-9a-f]{16})\.md$/.exec(String(appended))?.[1];
  if (sum === undefined || sections.length === 0 || checksum(sections.at(-1)) !== sum) return undefined;
  return sections.slice(0, -1);
}

/** Save an original, and take away the notes of its shape and the originals of its shape for other versions. */
function save(prompts, file, original, shape) {
  const { sources, originals } = textFolders(prompts);
  mkdirSync(originals, { recursive: true });
  writeFileSync(file, `${JSON.stringify(original)}\n`);
  for (const name of namesIn(originals)) {
    if (name !== path.basename(file) && name.endsWith(`-${shape}.json`)) rmSync(path.join(originals, name), { force: true });
  }
  for (const name of namesIn(sources)) {
    if (readJson(path.join(sources, name))?.shape === shape) rmSync(path.join(sources, name), { force: true });
  }
}

/**
 * The first `prompt_snapshot` record of a transcript: its sections, its
 * version, and the model the transcript names. Undefined when there is none.
 */
function firstRecord(file) {
  if (!existsSync(file)) return undefined;
  let record;
  let model;
  try {
    eachLine(file, (line) => {
      if (line === undefined) return false;
      if (model === undefined && line.includes('"model"')) model = modelIn(line);
      if (record === undefined && line.includes('"prompt_snapshot"')) record = snapshotIn(line);
      return record !== undefined && model !== undefined;
    });
  } catch {
    return undefined;
  }
  return record === undefined ? undefined : { ...record, model };
}

function snapshotIn(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  const attachment = parsed?.type === 'attachment' ? parsed.attachment : undefined;
  if (attachment?.type !== 'prompt_snapshot') return undefined;
  const sections = attachment.systemPrompt;
  if (!Array.isArray(sections) || !sections.every((one) => typeof one === 'string')) return undefined;
  return { sections, version: typeof parsed.version === 'string' ? parsed.version : undefined };
}

function modelIn(line) {
  try {
    const parsed = JSON.parse(line);
    const id = parsed?.type === 'attachment' && parsed.attachment?.type === 'model' ? parsed.attachment.identity?.modelId : undefined;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Take away the bot's main files that no session's book entry names and that
 * are not `current`. A session runs on the file its line named until it
 * starts again, so a named file stays.
 */
export function pruneMainFiles(prompts, named, current) {
  for (const name of mainFilesIn(prompts)) {
    if (name !== current && !named.includes(name)) rmSync(path.join(prompts, name), { force: true });
  }
}

/**
 * Health's findings on the saved originals of the bot: each recipe unit that
 * an original of a model the recipe names it for does not hold.
 */
export function unitsNotFound(prompts, botName) {
  const recipe = readRecipe();
  if (recipe === undefined) return [];
  const { originals } = textFolders(prompts);
  const found = [];
  for (const name of namesIn(originals)) {
    const original = readJson(path.join(originals, name));
    if (!Array.isArray(original?.sections) || typeof original.model !== 'string') continue;
    const held = new Set(original.sections.flatMap((section) => [unitHash(section), ...section.split('\n').map(unitHash)]));
    for (const unit of recipe.units) {
      if (!unit.models.includes(original.model) || held.has(unit.hash)) continue;
      found.push({
        where: path.join(originals, name),
        says: `The kit's recipe unit ${unit.name} is not in ${botName}'s record of ${original.model} on Claude Code ${original.version}, so the kit cannot cut it there and that part of the text stays. A newer kit may name it again.`,
      });
    }
  }
  return found;
}

/**
 * The launch shape of a Claude Code session (R5): what of its launch the main
 * text that Claude Code records depends on. Undefined when the bot's cut lists
 * cannot be read.
 */
export function shapeOf(bots, home, session, memoryFolder) {
  try {
    return launchShape(session, { home, memoryFolder, cuts: cutsOf(bots, home) });
  } catch {
    return undefined;
  }
}

/**
 * Health's sentences on the main text of the bot's Claude Code sessions: each
 * session noted on Claude Code's own main text, with why, or with a restart
 * when the kit's text is ready for it; and each session whose noted main file
 * is not the one the kit builds now.
 */
export function mainTextTrouble(bots, home, bot) {
  let book;
  try {
    book = readBook(home);
  } catch {
    return [];
  }
  const prompts = kitFolders(bots, bot.name).prompts;
  const said = [];
  for (const [name, entry] of Object.entries(book.sessions ?? {})) {
    const own = entry?.own_text === true;
    const main = typeof entry?.main === 'string' ? path.basename(entry.main) : undefined;
    if (!own && main === undefined) continue;
    const session = bot.sessions.find((one) => one.name === name);
    if (session === undefined || harnessOf(session, bot.harness) !== 'claude') continue;
    // A paused bot or session runs nothing, so it runs on no main text: it is
    // named again once it is unpaused and starts.
    if (bot.paused === true || session.paused === true) continue;
    const shape = shapeOf(bots, home, session, setsSettings(session) ? undefined : physicalMemoryFolder(home));
    let built;
    try {
      built = mainTextFor(bots, home, prompts, shape, { write: false });
    } catch (error) {
      built = { why: error.message };
    }
    if (own) {
      said.push(built.file === undefined
        ? `${bot.name}/${name} runs on Claude Code's own main text, not the one the kit builds, because ${built.why}.`
        : `${bot.name}/${name} runs on Claude Code's own main text, and the kit's main text is ready for it: obk restart starts it on the kit's text.`);
    } else if (built.file !== undefined && path.basename(built.file) !== main) {
      said.push(`${bot.name}/${name}'s main text is older than the one the kit builds now: it came from ${path.join(prompts, main)}. It gets the new text after obk restart and its next compaction.`);
    }
  }
  return said;
}

/** The files of the bot's main text in `prompts`: its sources, its originals and its main files. */
export const textFilesOf = (prompts) => [
  ...Object.values(textFolders(prompts)).filter((folder) => existsSync(folder)),
  ...mainFilesIn(prompts).map((name) => path.join(prompts, name)),
];

function namesIn(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}
