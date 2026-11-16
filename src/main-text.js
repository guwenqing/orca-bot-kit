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
// system text on it but the kit's appended file (record.js), with the model it
// should run on. The kit reads the first record of a noted conversation only,
// takes it only when the record ran on that model, and takes the appended
// section out after it checks it by its sum.
//
// A saved original fits only a launch that is the same as the one it was
// recorded under: the same Claude Code version, the same launch words that do
// not change from one conversation to the next, the same tool and skill cuts,
// and the same Claude Code settings. A flag, a model or a tool cut changes the main text, so a source of
// another launch could give a session a text that its tools do not match.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { claudeTranscript } from './conversations.js';
import { readBook } from './book.js';
import { cutsOf } from './cuts.js';
import { claudeTextFolder, harnessOf, launchShape, setsSettings } from './launch.js';
import { eachLine } from './lines.js';
import { claudeSettingsFiles, physicalMemoryFolder } from './memory.js';

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

/** The folders of the bot's notes and saved originals, in its main text folder `text`. */
export const textFolders = (text) => ({
  sources: path.join(text, 'sources'),
  originals: path.join(text, 'originals'),
});

/** The bot's main files in its main text folder `text`, by name. */
export const mainFilesIn = (text) => namesIn(text).filter((name) => MAIN_NAME.test(name));

/**
 * Note the conversation `id` as a source, under the launch shape `shape`, with
 * the name of the kit's appended file its line carried (or null for none), and
 * `model`, the model it should run on. Called by the hook on a start or a
 * clear only. With no model, nothing is noted: the record cannot be checked.
 */
export function noteSource(text, id, { shape, appended, model }) {
  if (typeof id !== 'string' || !SAFE_ID.test(id) || typeof shape !== 'string' || typeof model !== 'string' || model === '') return;
  const { sources } = textFolders(text);
  mkdirSync(sources, { recursive: true });
  writeFileSync(path.join(sources, `${id}.json`), `${JSON.stringify({ conversation: id, shape, appended: appended ?? null, model, at: new Date().toISOString() })}\n`);
}

/**
 * The text cuts of the bot at `home`: the kit's default `text:` units, and the
 * user's, less the bot's keeps.
 */
const textCutsOf = (bots, home) => cutsOf(bots, home).text;

/**
 * The bot's main text for a launch of shape `shape`: `{ file, text }` when the
 * kit can build it, or `{ why }` when the session runs on Claude Code's own
 * main text, with `wait` when that is the normal wait for a first record of
 * the version or the launch, which asks nothing of the user. With `write`, the original is saved, the notes it came from go,
 * and the main file is written; without it, nothing is written (health).
 */
export function mainTextFor(bots, home, text, shape, { write = true } = {}) {
  const recipe = readRecipe();
  if (recipe === undefined) return { why: 'the kit\'s recipe could not be read' };
  if (typeof shape !== 'string') return { why: 'the kit cannot tell what its launch gives Claude Code: its cut lists cannot be read' };

  const { sources, originals } = textFolders(text);
  // Without a note or a saved original nothing can fit, and Claude Code is not asked.
  if (namesIn(sources).length === 0 && namesIn(originals).length === 0) {
    return { why: `no conversation of the bot on the kit's line is on record yet. ${RECORDS}`, wait: true };
  }
  const installed = claudeVersion();
  if (installed.version === undefined) return { why: installed.why };

  const { original, declined } = originalFor(home, text, shape, installed.version, write);
  if (original === undefined && declined !== undefined) {
    return {
      why: `its noted conversation ${declined.conversation} ran on ${declined.ran}, not on ${declined.expected}, the model it started with or its line names, so the kit does not build from it. A model named on the line by its full id, as the record names it (${declined.ran}), lets a clear record a source. ${RECORDS}`,
      version: installed.version,
    };
  }
  if (original === undefined) {
    return {
      why: `no conversation of Claude Code ${installed.version} with this session's launch is on record yet. ${RECORDS}`,
      version: installed.version,
      wait: true,
    };
  }

  let cut;
  try {
    cut = textCutsOf(bots, home);
  } catch (error) {
    return { why: error.message };
  }
  const built = buildMainText(original.sections, { recipe, cut });
  const file = path.join(text, `main-${checksum(built.text)}.md`);
  if (write) {
    mkdirSync(text, { recursive: true });
    if (!existsSync(file) || readFileSync(file, 'utf8') !== built.text) writeFileSync(file, built.text);
  }
  return { file, text: built.text, version: installed.version };
}

/**
 * What a session of the shape and version is built from: `{ original }`, the
 * saved original, or one read from the newest noted conversation that fits,
 * saved when `write` is set. With none, `{ declined }` names the newest note of
 * the version that its record's model did not fit, or `{}`.
 */
function originalFor(home, text, shape, version, write) {
  const { sources, originals } = textFolders(text);
  const saved = path.join(originals, `${version}-${shape}.json`);
  const kept = readJson(saved);
  if (Array.isArray(kept?.sections) && kept.sections.every((one) => typeof one === 'string')) return { original: kept };

  let real;
  try {
    real = realpathSync(home);
  } catch {
    return {};
  }
  const notes = namesIn(sources)
    .map((name) => readJson(path.join(sources, name)))
    .filter((note) => note?.shape === shape && typeof note.conversation === 'string' && SAFE_ID.test(note.conversation))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  let declined;
  for (const note of notes) {
    const record = firstRecord(claudeTranscript(real, note.conversation));
    if (record === undefined || record.version !== version) continue;
    // A record of another model than the one the session should run on: a
    // switch of model before its first request, such as /model before a clear.
    if (typeof note.model !== 'string' || record.model !== note.model) {
      declined ??= { conversation: note.conversation, expected: note.model ?? 'no model', ran: record.model ?? 'no model it names' };
      continue;
    }
    const sections = withoutAppended(record.sections, note.appended);
    if (sections === undefined) continue;
    const original = { version, shape, model: record.model, conversation: note.conversation, sections };
    if (write) save(text, saved, original, shape);
    return { original };
  }
  return declined === undefined ? {} : { declined };
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
function save(text, file, original, shape) {
  const { sources, originals } = textFolders(text);
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

/** How long a note may wait for its conversation's first record. */
const NOTE_DAYS = 7;

/**
 * Take away the bot's saved originals of any Claude Code version but
 * `version`, the installed one: they fit no launch now. An original of the
 * installed version stays whatever its shape, so a temporary session of a
 * role finds its role's original between two sessions. And take away each
 * note whose conversation's first record is of another version, or that has
 * waited more than a week with no record: neither can fit a launch of the
 * installed version. A note of the installed version stays, for a later
 * session of its shape. So the folder holds the originals and notes of one
 * version, and drops them at the next.
 */
export function pruneOriginals(home, text, version) {
  if (typeof version !== 'string') return;
  const { sources, originals } = textFolders(text);
  for (const name of namesIn(originals)) {
    if (!name.startsWith(`${version}-`)) rmSync(path.join(originals, name), { force: true });
  }
  let real;
  try {
    real = realpathSync(home);
  } catch {
    return;
  }
  const old = Date.now() - NOTE_DAYS * 24 * 60 * 60 * 1000;
  for (const name of namesIn(sources)) {
    const note = readJson(path.join(sources, name));
    const record = typeof note?.conversation === 'string' && SAFE_ID.test(note.conversation)
      ? firstRecord(claudeTranscript(real, note.conversation))
      : undefined;
    const stale = record === undefined ? !(Date.parse(note?.at) > old) : record.version !== version;
    if (stale) rmSync(path.join(sources, name), { force: true });
  }
}

/**
 * Take away the bot's main files that no session's book entry names and that
 * are not `current`. A session runs on the file its line named until it
 * starts again, so a named file stays.
 */
export function pruneMainFiles(text, named, current) {
  for (const name of mainFilesIn(text)) {
    if (name !== current && !named.includes(name)) rmSync(path.join(text, name), { force: true });
  }
}

/**
 * Health's findings on the saved originals of the bot: each recipe unit that
 * an original of a model the recipe names it for does not hold.
 */
export function unitsNotFound(text, botName) {
  const recipe = readRecipe();
  if (recipe === undefined) return [];
  const { originals } = textFolders(text);
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
    // A session with its own --settings in its extra arguments gets no shape:
    // the shell may make its word name any file, so the kit cannot tell what
    // it gives Claude Code, and the session runs on Claude Code's own text.
    if (setsSettings(session)) return undefined;
    const named = typeof session.model === 'string' && session.model !== '';
    return launchShape(session, { home, memoryFolder, cuts: cutsOf(bots, home), settings: claudeSettingsFiles(home).map((file) => settingsSum(file, { named })) });
  } catch {
    return undefined;
  }
}

/**
 * A sum of what a Claude Code settings file says, for the launch shape: a
 * hand-named memory folder, an output style or a deny rule changes the main
 * text, so a change of the file is another shape. Its allow and ask rules are
 * left out: they leave the main text as it is (fenced probe, 2.1.325), and
 * they change most often, by obk permission allow and by a person's answer to
 * a prompt. With `named`, a model on the line, the file's default model is left
 * out too: /model writes it in the user's file, and a line's model wins over it
 * (fenced probe, 2.1.325). A file that is not there, or says nothing else, is
 * "none"; one that cannot be read as JSON is summed as it stands.
 */
function settingsSum(file, { named }) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'none' : `unread:${error.code}`;
  }
  let settings;
  try {
    settings = JSON.parse(text);
  } catch {
    return unitHash(text);
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return unitHash(text);
  const { permissions, model, ...rest } = settings;
  if (!named && model !== undefined) rest.model = model;
  if (permissions !== null && typeof permissions === 'object' && !Array.isArray(permissions)) {
    const { allow, ask, ...kept } = permissions;
    if (Object.keys(kept).length > 0) rest.permissions = kept;
  } else if (permissions !== undefined) {
    rest.permissions = permissions;
  }
  return Object.keys(rest).length === 0 ? 'none' : unitHash(JSON.stringify(rest));
}

/**
 * Health's word on the main text of the bot's Claude Code sessions (R5):
 * `found`, a sentence for each session that runs on Claude Code's own main
 * text for a reason the user must act on; and `states`, by session, what each
 * one runs on, for its line in health's report, which fails nothing: `kit`,
 * `older` (a main file older than the one the kit builds now, with how it gets
 * the new one), or `own`, with why, when that is the normal wait for a first
 * record, or the kit's text is ready for its restart.
 */
export function mainTextTrouble(bots, home, bot) {
  let book;
  try {
    book = readBook(home);
  } catch {
    return { found: [], states: {} };
  }
  const text = claudeTextFolder(bots, bot.name);
  const found = [];
  const states = {};
  for (const [name, entry] of Object.entries(book.sessions ?? {})) {
    const own = entry?.own_text === true;
    const main = typeof entry?.main === 'string' ? path.basename(entry.main) : undefined;
    if (!own && main === undefined) continue;
    const session = bot.sessions.find((one) => one.name === name);
    if (session === undefined || harnessOf(session, bot.harness) !== 'claude') continue;
    // A paused bot or session runs nothing, so it runs on no main text: it is
    // named again once it is unpaused and starts.
    if (bot.paused === true || session.paused === true) continue;
    // The user's own --settings: their choice, which health names once, with
    // what the session runs without (ownSettings). Only for a session that the
    // book has on its own text: one whose launch named the kit's main file runs
    // on it until it restarts, whatever bot.yaml says now.
    if (own && setsSettings(session)) {
      states[name] = { state: 'own', why: 'its extra arguments carry its own --settings, so the kit does not build its main text' };
      continue;
    }
    // A session on the kit's main file is judged by the launch the book
    // recorded for it, which holds until it restarts; one on its own text by
    // the launch it would get now.
    const shape = !own && typeof entry.shape === 'string'
      ? entry.shape
      : shapeOf(bots, home, session, setsSettings(session) ? undefined : physicalMemoryFolder(home));
    let built;
    try {
      built = mainTextFor(bots, home, text, shape, { write: false });
    } catch (error) {
      built = { why: error.message };
    }
    if (own && built.file !== undefined) {
      states[name] = { state: 'own', why: 'the kit\'s main text is ready for it: after obk restart it runs on the kit\'s text, at once in a new conversation, and in a resumed one after its next compaction or clear' };
    } else if (own && built.wait === true) {
      states[name] = { state: 'own', why: built.why };
    } else if (own) {
      states[name] = { state: 'own', why: built.why };
      found.push(`${bot.name}/${name} runs on Claude Code's own main text, not the one the kit builds, because ${built.why}.`);
    } else if (built.file !== undefined && path.basename(built.file) !== main) {
      states[name] = { state: 'older', why: `it came from ${path.join(text, main)}, and it gets the new text after obk restart: at once in a new conversation, and in a resumed one after its next compaction or clear` };
    } else {
      states[name] = { state: 'kit' };
    }
  }
  return { found, states };
}

/**
 * What tells a user when a session records a source, and when it gets the
 * kit's text after that. A resume keeps its conversation's recorded text
 * until its next compaction (tech notes, the snapshot).
 */
const RECORDS = 'A new conversation on the kit\'s line records one: a first start, or a clear (obk session clear). A resume records nothing. After that the session gets the kit\'s text at its next start: at once in a new conversation, and in a resumed one after its next compaction or clear';

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
