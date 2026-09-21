// What the fleet's work came to in tokens (PRD 6.8).
//
// The countable half of finops, and only that half. This reports how many calls
// a conversation made, how many tokens of which kind they used, at which models
// and efforts, between which two moments, and how many times it was compacted.
// What any of that costs is a skill's to work out: a price comes from a live
// lookup and a price that cannot be found has to be said to be unknown, which is
// judgement and not arithmetic (ADR 0006).
//
// Which conversation belongs to which session is the book's to say and is never
// guessed, as everywhere else in the kit (ADR 0002). A session's conversations
// are the one the book names for it now and the ones in its history. One in the
// bot's folder that no session claims is reported under the bot instead, with
// its figures, so that what it spent is visible rather than quietly dropped.
//
// The harnesses are read, never written, and Orca is not involved.
//
// Three things here are not the obvious reading of the files, and all three are
// measured in the tech notes (sections 2 and 3):
//
//   1. Codex's `total_token_usage` is the running total for the conversation.
//      Adding it up across the events double counts. `last_token_usage` is the
//      per-call figure, and summing those lands on the final total exactly.
//   2. The two harnesses do not mean the same thing by `input_tokens`. Claude
//      Code leaves the cache reads out of it; Codex counts them inside it. So
//      the Codex figure has its cached tokens taken back out, and `input` means
//      uncached input on both. Taken as written, one is many times the other for
//      the same work, and the cached tokens get priced at full rate.
//   3. Claude Code writes the same call down more than once, so a call counts
//      once per `requestId` and `message.id`.

import { readFileSync } from 'node:fs';

import { botDir, botNames, readBot } from './bot.js';
import { readBook } from './book.js';
import { transcriptsIn } from './conversations.js';
import { harnessOf } from './launch.js';

/** The kinds a call's tokens are reported in, the same on either harness. */
const KINDS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning'];

/**
 * What each bot's sessions have used. `since` counts the calls made at or after
 * that moment rather than the conversations begun after it: a conversation that
 * started this morning and is still going has spent everything it spent today,
 * and a filter on when it began would drop the lot.
 */
export function readUsage(bots, { bot: only, session: onlySession, since } = {}) {
  const names = botNames(bots);
  if (only !== undefined && !names.includes(only)) {
    throw new Error(`there is no bot called ${only} in ${bots}. The bots there are: ${names.join(', ') || 'none'}.`);
  }

  const from = since === undefined ? 0 : Date.parse(since);
  if (Number.isNaN(from)) {
    throw new Error(`--since is a moment, such as 2026-09-20T08:00:00Z, and got: ${since}`);
  }

  return (only === undefined ? names : [only]).map((name) => forBot(bots, name, onlySession, from));
}

/** One bot: what each of its sessions used, and what nobody claims. */
function forBot(bots, name, onlySession, from) {
  const home = botDir(bots, name);
  const bot = readBot(home, name);
  const book = readBook(home);

  // A bot's sessions may sit on different harnesses, so every harness any of
  // them runs on is asked. The bot's own is the answer when it has no sessions.
  const harnesses = new Set(bot.sessions.map((session) => harnessOf(session, bot.harness)));
  if (harnesses.size === 0) harnesses.add(bot.harness);

  const onRecord = new Map();
  for (const harness of harnesses) {
    if (harness === undefined) continue;
    // Read without a `since`: that filter is about when a conversation began,
    // and what is wanted here is every conversation that has spent anything in
    // the window, however long ago it started.
    for (const one of transcriptsIn(harness, home)) {
      if (!onRecord.has(one.id)) onRecord.set(one.id, { ...one, harness });
    }
  }

  const claimed = new Set();
  for (const entry of Object.values(book.sessions)) for (const id of idsIn(entry)) claimed.add(id);

  const sessions = bot.sessions
    .filter((session) => onlySession === undefined || session.name === onlySession)
    .map((session) => ({
      name: session.name,
      conversations: idsIn(book.sessions[session.name] ?? {})
        .filter((id) => onRecord.has(id))
        .map((id) => counted(onRecord.get(id), from))
        .filter((one) => one !== undefined),
    }));

  const unclaimed = [...onRecord.values()]
    .filter((one) => !claimed.has(one.id))
    .map((one) => counted(one, from))
    .filter((one) => one !== undefined);

  return { bot: name, home, sessions, unclaimed };
}

/** The conversations a book entry names: the one it is in, then the ones before. */
const idsIn = (entry) => [
  ...(typeof entry.session === 'string' ? [entry.session] : []),
  ...(entry.history ?? []).map((was) => was?.session).filter((id) => typeof id === 'string'),
];

/**
 * One conversation, counted. A conversation that spent nothing in the window is
 * left out rather than reported as a row of zeroes: it is not part of what has
 * happened since, and a page of zeroes is harder to read than a shorter page.
 */
function counted(one, from) {
  const read = one.harness === 'claude' ? fromClaude : fromCodex;
  const tally = {
    calls: 0,
    compactions: 0,
    tokens: Object.fromEntries(KINDS.map((kind) => [kind, 0])),
    models: new Set(),
    efforts: new Set(),
    first: undefined,
    last: undefined,
  };

  read(lines(one.file), from, tally);
  if (tally.calls === 0) return undefined;

  return {
    id: one.id,
    calls: tally.calls,
    tokens: tally.tokens,
    models: [...tally.models],
    efforts: [...tally.efforts],
    compactions: tally.compactions,
    first: new Date(tally.first).toISOString(),
    last: new Date(tally.last).toISOString(),
  };
}

/**
 * What Claude Code wrote down: usage on each `assistant` line, the cache reads
 * already outside `input_tokens`, and a compaction as a line of its own with a
 * `type` and a `subtype` rather than a word anywhere in the text.
 */
function fromClaude(entries, from, tally) {
  const seen = new Set();

  for (const entry of entries) {
    const when = Date.parse(entry.timestamp ?? '');
    if (!Number.isNaN(when) && when < from) continue;

    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      tally.compactions += 1;
      continue;
    }
    if (entry.type !== 'assistant') continue;

    const usage = entry.message?.usage;
    if (usage === undefined || usage === null) continue;

    // The same call, written down again, is the same call.
    const call = `${entry.requestId}\u0000${entry.message?.id}`;
    if (seen.has(call)) continue;
    seen.add(call);

    tally.calls += 1;
    tally.tokens.input += number(usage.input_tokens);
    tally.tokens.output += number(usage.output_tokens);
    tally.tokens.cache_read += number(usage.cache_read_input_tokens);
    tally.tokens.cache_write += number(usage.cache_creation_input_tokens);
    add(tally.models, entry.message?.model);
    add(tally.efforts, entry.effort);
    mark(tally, when);
  }
}

/**
 * What Codex wrote down: a `token_count` event per call, the model and effort
 * from whichever `turn_context` was last in force rather than from the call, and
 * the cached tokens inside `input_tokens` where Claude Code keeps them outside.
 */
function fromCodex(entries, from, tally) {
  let model;
  let effort;

  for (const entry of entries) {
    const when = Date.parse(entry.timestamp ?? '');

    // Read whatever it was set to even when the window has not opened yet: the
    // turn that governs a call can have been set hours before the call was made.
    if (entry.type === 'turn_context') {
      model = entry.payload?.model ?? model;
      effort = entry.payload?.effort ?? effort;
      continue;
    }
    if (!Number.isNaN(when) && when < from) continue;

    if (entry.type === 'compacted') {
      tally.compactions += 1;
      continue;
    }
    if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count') continue;

    const used = entry.payload?.info?.last_token_usage;
    if (used === undefined || used === null) continue;

    const cached = number(used.cached_input_tokens);
    tally.calls += 1;
    // Uncached input, so that the figure means on Codex what it means on Claude.
    tally.tokens.input += Math.max(number(used.input_tokens) - cached, 0);
    tally.tokens.output += number(used.output_tokens);
    tally.tokens.cache_read += cached;
    tally.tokens.cache_write += number(used.cache_write_input_tokens);
    tally.tokens.reasoning += number(used.reasoning_output_tokens);
    add(tally.models, model);
    add(tally.efforts, effort);
    mark(tally, when);
  }
}

/** The lines of a transcript that are readable JSON; the rest say nothing. */
function lines(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    // A transcript that cannot be read is a conversation the kit knows nothing
    // about, which is the honest answer rather than a run that stops.
    return [];
  }
  return text.split('\n').flatMap((line) => {
    if (line.trim() === '') return [];
    try {
      const entry = JSON.parse(line);
      return entry !== null && typeof entry === 'object' ? [entry] : [];
    } catch {
      return [];
    }
  });
}

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const add = (set, value) => {
  if (typeof value === 'string' && value !== '') set.add(value);
};

/** When the first and the last counted call of this conversation were. */
function mark(tally, when) {
  if (Number.isNaN(when)) return;
  if (tally.first === undefined || when < tally.first) tally.first = when;
  if (tally.last === undefined || when > tally.last) tally.last = when;
}
