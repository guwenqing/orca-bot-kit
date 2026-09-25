// What the fleet's work came to in tokens (PRD 6.8).
//
// The countable half of finops, and only that half. This reports how many calls
// a conversation made, how many tokens of which kind they used, at which models
// and efforts, between which two moments, and how many times it was compacted.
// What any of that costs is a skill's to work out: a price comes from a live
// lookup and a price that cannot be found has to be said to be unknown, which is
// judgement and not arithmetic (ADR 0016).
//
// Which conversation belongs to which session is the book's to say and is never
// guessed, as everywhere else in the kit (ADR 0012). A session's conversations
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
//      Adding it up across the events double counts, and summing the per-call
//      `last_token_usage` counts a call written down twice twice. So a call is
//      the difference in the running total from the event before: none is a
//      repeat, and a fall is a new window, whose own `last_token_usage` counts.
//   2. The two harnesses do not mean the same thing by `input_tokens`. Claude
//      Code leaves the cache reads out of it; Codex counts them inside it. So
//      the Codex figure has its cached tokens taken back out, and `input` means
//      uncached input on both. Taken as written, one is many times the other for
//      the same work, and the cached tokens get priced at full rate.
//   3. Claude Code writes the same call down more than once, so a call counts
//      once per `requestId` and `message.id`.

import { readFileSync, realpathSync } from 'node:fs';

import { botDir, botNames, readBot } from './bot.js';
import { readBook, sessionIdsIn } from './book.js';
import { transcriptsIn } from './conversations.js';
import { harnessOf } from './launch.js';

/** The kinds a call's tokens are reported in, the same on either harness. */
const KINDS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning'];

/**
 * What could not be counted, by why. A figure that quietly leaves something out
 * reads as complete, so what is left out is said, and the totals cover only what
 * was counted: nothing missing is guessed at, nor taken as zero, nor placed in a
 * window it has no time to be placed in.
 */
const GAPS = ['unreadable_transcripts', 'broken_lines', 'records_without_numbers', 'records_without_time'];

const noGaps = () => Object.fromEntries(GAPS.map((gap) => [gap, 0]));

const addGaps = (into, more) => {
  for (const gap of GAPS) into[gap] += more[gap];
  return into;
};

/**
 * What each bot's sessions have used. `since` counts the calls made at or after
 * that moment rather than the conversations begun after it: a conversation that
 * started this morning and is still going has spent everything it spent today,
 * and a filter on when it began would drop the lot. `until` counts the calls made
 * before its moment, not at it, so one run's `until` is the next run's `since`
 * and a call on the boundary is counted once.
 */
export function readUsage(bots, { bot: only, session: onlySession, since, until } = {}) {
  const names = botNames(bots);
  if (only !== undefined && !names.includes(only)) {
    throw new Error(`there is no bot called ${only} in ${bots}. The bots there are: ${names.join(', ') || 'none'}.`);
  }

  const from = since === undefined ? 0 : Date.parse(since);
  if (Number.isNaN(from)) {
    throw new Error(`--since is a moment, such as 2026-09-20T08:00:00Z, and got: ${since}`);
  }
  const to = until === undefined ? Infinity : Date.parse(until);
  if (Number.isNaN(to)) {
    throw new Error(`--until is a moment, such as 2026-09-21T08:00:00Z, and got: ${until}`);
  }
  if (to < from) {
    throw new Error(`--until is before --since, so there is no window between them: ${until} comes before ${since}.`);
  }

  return (only === undefined ? names : [only]).map((name) => forBot(bots, name, onlySession, { from, to }));
}

/** One bot: what each of its sessions used, and what nobody claims. */
function forBot(bots, name, onlySession, window) {
  // The folder as the file system knows it, not as the caller spelled it: a
  // bots folder reached through a symlink is the same fleet, and the harnesses
  // file their transcripts under the real path (as `restart` and `message` do).
  const home = realHome(botDir(bots, name));
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

  const claimed = sessionIdsIn(book);

  const sessions = bot.sessions
    .filter((session) => onlySession === undefined || session.name === onlySession)
    .map((session) => {
      const { conversations, gaps } = all(
        idsIn(book.sessions[session.name] ?? {}).filter((id) => onRecord.has(id)).map((id) => onRecord.get(id)),
        window,
      );
      return { name: session.name, conversations, not_counted: gaps };
    });

  const unclaimed = all([...onRecord.values()].filter((one) => !claimed.has(one.id)), window);

  return { bot: name, home, sessions, unclaimed: unclaimed.conversations, unclaimed_not_counted: unclaimed.gaps };
}

/** Some conversations counted, and what all of them together could not count. */
function all(transcripts, window) {
  const gaps = noGaps();
  const conversations = transcripts.flatMap((one) => {
    const { row, gaps: its } = counted(one, window);
    addGaps(gaps, its);
    return row === undefined ? [] : [row];
  });
  return { conversations, gaps };
}

/** The conversations a book entry names: the one it is in, then the ones before. */
const idsIn = (entry) => [
  ...(typeof entry.session === 'string' ? [entry.session] : []),
  ...(entry.history ?? []).map((was) => was?.session).filter((id) => typeof id === 'string'),
];

/**
 * One conversation, counted, and what in it could not be. A conversation that
 * spent nothing in the window has no row rather than a row of zeroes: it is not
 * part of what has happened since, and a page of zeroes is harder to read than a
 * shorter page. What it could not count is still said.
 */
function counted(one, window) {
  const read = one.harness === 'claude' ? fromClaude : fromCodex;
  const tally = {
    calls: 0,
    compactions: 0,
    tokens: Object.fromEntries(KINDS.map((kind) => [kind, 0])),
    models: new Set(),
    efforts: new Set(),
    // Per model, because two models are two prices: a conversation that ran on
    // both cannot be costed from one total however well the prices are known.
    byModel: new Map(),
    first: undefined,
    last: undefined,
    gaps: noGaps(),
  };

  const { entries, unreadable, broken } = transcript(one.file);
  tally.gaps.unreadable_transcripts = unreadable;
  tally.gaps.broken_lines = broken;
  read(entries, window, tally);
  if (tally.calls === 0 && KINDS.every((kind) => tally.tokens[kind] === 0)) return { gaps: tally.gaps };

  return { gaps: tally.gaps, row: {
    id: one.id,
    calls: tally.calls,
    tokens: tally.tokens,
    by_model: [...tally.byModel].map(([model, its]) => ({ model, calls: its.calls, tokens: its.tokens })),
    models: [...tally.models],
    efforts: [...tally.efforts],
    compactions: tally.compactions,
    first: new Date(tally.first).toISOString(),
    last: new Date(tally.last).toISOString(),
  } };
}

/**
 * What Claude Code wrote down: usage on each `assistant` line, the cache reads
 * already outside `input_tokens`, and a compaction as a line of its own with a
 * `type` and a `subtype` rather than a word anywhere in the text.
 *
 * The same call can be written down more than once, and the later record is the
 * finished one: a pair has been seen with `output_tokens` going from 16 to 301
 * between two lines a second apart (tech notes, section 2). So the records are
 * gathered first and the last of each pair is what counts. Keeping the first
 * looks right for a very long time, because almost every repeat is identical.
 *
 * But the call was made when it was first written down, and grew after. So it
 * is counted as a call once, in the window its first record falls in, and its
 * tokens are what it grew by in the window: its figures in its last record
 * before the window's end, less those in its last record before the window's
 * start. A transcript only grows, so one run's end is the next run's start and
 * the runs add up to the whole, with a call still being written at a boundary
 * charged once, part to each side (#169).
 *
 * A record with no time, or with a figure missing, is left out whole and said to
 * be; the call it belongs to is counted from its other records, if it has any.
 * But when the record last written before the window's start is one of those,
 * what the call had grown to by then is not known, and what it grew by inside
 * the window cannot be told apart from what it grew by before. So the call is
 * not counted in that window, and is said to be.
 */
function fromClaude(entries, window, tally) {
  const byCall = new Map();

  for (const entry of entries) {
    const when = Date.parse(entry.timestamp ?? '');
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      if (Number.isNaN(when)) tally.gaps.records_without_time += 1;
      else if (inside(when, window)) tally.compactions += 1;
      continue;
    }
    if (entry.type !== 'assistant') continue;

    const usage = entry.message?.usage;
    if (usage === undefined || usage === null) continue;
    if (Number.isNaN(when)) {
      tally.gaps.records_without_time += 1;
      continue;
    }
    const broken = !complete(usage, CLAUDE_FIELDS);
    if (broken && inside(when, window)) tally.gaps.records_without_numbers += 1;
    const call = `${entry.requestId}\u0000${entry.message?.id}`;
    if (!byCall.has(call)) byCall.set(call, []);
    byCall.get(call).push({ entry, when, broken });
  }

  for (const records of byCall.values()) {
    const made = records[0].when;
    const atEnd = records.findLast(({ when, broken }) => !broken && when < window.to);
    if (atEnd === undefined) continue;
    const atStart = records.findLast(({ when }) => when < window.from);
    if (atStart?.broken) {
      if (inside(atEnd.when, window)) tally.gaps.records_without_numbers += 1;
      continue;
    }

    const now = figures(atEnd.entry);
    const was = atStart === undefined ? undefined : figures(atStart.entry);
    const grew = Object.fromEntries(KINDS.map((kind) => [kind, now[kind] - (was?.[kind] ?? 0)]));
    const isNew = inside(made, window);
    if (!isNew && KINDS.every((kind) => grew[kind] === 0)) continue;

    count(tally, grew, atEnd.entry.message?.model, atEnd.entry.effort, isNew ? made : atEnd.when, isNew ? 1 : 0);
  }
}

/** The figures Claude Code writes on every call, all of which a record needs to be counted. */
const CLAUDE_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];

/** What one Claude Code record says its call used so far. */
function figures(entry) {
  const usage = entry.message.usage;
  return {
    input: number(usage.input_tokens),
    output: number(usage.output_tokens),
    cache_read: number(usage.cache_read_input_tokens),
    cache_write: number(usage.cache_creation_input_tokens),
    // Claude Code does not report the thinking apart from the rest.
    reasoning: 0,
  };
}

/** The fields Codex writes a usage figure in, both per call and as a running total. */
const CODEX_FIELDS = [
  'input_tokens',
  'cached_input_tokens',
  'cache_write_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
];

/**
 * What Codex wrote down, which needs more care than it looks.
 *
 * Each event carries what the last call used and what the conversation has used
 * altogether, and neither can simply be added up (tech notes, section 3). An
 * event can repeat the one before it, with the same per-call figure and the
 * running total unmoved, and adding the per-call figures counts that twice. The
 * running total can also reset part way through, a new window, and taking the
 * final one then reports only what came after the reset.
 *
 * So a call is counted by what it added to the running total: a rise is that
 * call's usage, no change is the same call written twice, and a fall is a new
 * window where the event's own per-call figure is what it used. Within a window
 * the rise equals the per-call figure exactly, which is why the wrong rules look
 * right on any conversation short enough to read by hand.
 *
 * The running total is followed through events outside the window as well, since
 * what a call added can only be measured against the event before it.
 *
 * An event whose running total has a figure missing is left out and said to be,
 * and after it the running total is not known, so neither is what the next
 * complete event added. Measured against the event before the broken one, it
 * would take in what the broken one used, at its own time and perhaps in
 * another window; taken by its own per-call figure, it may be the broken one
 * written down again. Telling those apart is guessing, so it is not counted
 * either, and is said to be; the running total follows on from it. A call whose
 * figure is needed and has something missing is not counted, and is said to
 * be; nothing missing is taken as zero.
 */
function fromCodex(entries, window, tally) {
  let model;
  let effort;
  let running;
  // Whether a running total with something missing came since the last complete one.
  let broken = false;

  for (const entry of entries) {
    const when = Date.parse(entry.timestamp ?? '');

    // Read whatever it was set to even before the window opens: the turn that
    // governs a call can have been set hours before the call was made.
    if (entry.type === 'turn_context') {
      model = entry.payload?.model ?? model;
      effort = entry.payload?.effort ?? effort;
      continue;
    }
    if (entry.type === 'compacted') {
      if (Number.isNaN(when)) tally.gaps.records_without_time += 1;
      else if (inside(when, window)) tally.compactions += 1;
      continue;
    }
    if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count') continue;

    // No `info` is a note about rate limits, not a record of usage.
    const info = entry.payload?.info;
    if (info === undefined || info === null) continue;

    const total = info.total_token_usage ?? undefined;
    let used;
    if (total === undefined) {
      // Nothing to measure against: the per-call figure is all there is. After a
      // broken running total it may be the broken one written again, so it is
      // not counted either until a complete running total says where things are.
      used = broken ? null : perCall(info);
    } else if (!complete(total, CODEX_READ)) {
      used = null;
      broken = true;
    } else {
      used = broken ? null : spent(running, total, info);
      running = total;
      broken = false;
    }

    // A repeat is not a call, whether or not it is inside the window.
    if (used === undefined) continue;
    if (Number.isNaN(when)) {
      tally.gaps.records_without_time += 1;
      continue;
    }
    if (!inside(when, window)) continue;
    if (used === null) {
      tally.gaps.records_without_numbers += 1;
      continue;
    }

    count(tally, used, model, effort, when);
  }
}

/** The fields Codex itself writes; it has no cache writes to report. */
const CODEX_READ = CODEX_FIELDS.filter((field) => field !== 'cache_write_input_tokens').concat('total_tokens');

/**
 * What one Codex event says its call used, measured against the running total
 * before it: `undefined` where the event is the one before written down again,
 * and `null` where what it used cannot be known.
 */
function spent(running, total, info) {
  if (running === undefined) return kindsOf(total);

  const moved = total.total_tokens - running.total_tokens;
  if (moved === 0) return undefined;
  // A fall is a new window, and the running total is counting again from there.
  if (moved < 0) return perCall(info);

  return kindsOf(Object.fromEntries(
    CODEX_FIELDS.map((field) => [field, number(total[field]) - number(running[field])]),
  ));
}

/** A Codex event's own per-call figure, or `null` when something in it is missing. */
const perCall = (info) =>
  complete(info.last_token_usage, CODEX_READ) ? kindsOf(info.last_token_usage) : null;

/**
 * One Codex figure in the kinds this command reports. The cached tokens sit
 * inside `input_tokens` here and outside it on Claude Code, so they come out of
 * the input and are reported beside it, which makes `input` mean uncached input
 * on both (tech notes, sections 2 and 3).
 */
function kindsOf(raw) {
  const cached = number(raw?.cached_input_tokens);
  return {
    input: Math.max(number(raw?.input_tokens) - cached, 0),
    output: number(raw?.output_tokens),
    cache_read: cached,
    cache_write: number(raw?.cache_write_input_tokens),
    reasoning: number(raw?.reasoning_output_tokens),
  };
}

/**
 * Add one call to what the conversation used, and to what the model that ran it
 * used. A call whose model nothing names is still counted in the total; it is
 * the total that has to be complete, and a row headed by nothing would be worse
 * than no row.
 */
function count(tally, used, model, effort, when, calls = 1) {
  tally.calls += calls;
  for (const kind of KINDS) tally.tokens[kind] += used[kind];
  add(tally.models, model);
  add(tally.efforts, effort);
  mark(tally, when);

  if (typeof model !== 'string' || model === '') return;
  if (!tally.byModel.has(model)) {
    tally.byModel.set(model, { calls: 0, tokens: Object.fromEntries(KINDS.map((kind) => [kind, 0])) });
  }
  const its = tally.byModel.get(model);
  its.calls += calls;
  for (const kind of KINDS) its.tokens[kind] += used[kind];
}

/** The lines of a transcript that are readable JSON; the rest say nothing. */
export const lines = (file) => transcript(file).entries;

/**
 * The lines of a transcript that are JSON records, and how many were not. A
 * transcript that cannot be read is said to be, rather than a run that stops.
 */
function transcript(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { entries: [], unreadable: 1, broken: 0 };
  }
  let broken = 0;
  const entries = text.split('\n').flatMap((line) => {
    if (line.trim() === '') return [];
    try {
      const entry = JSON.parse(line);
      if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) return [entry];
    } catch {
      // Counted below with any other line that is not a record.
    }
    broken += 1;
    return [];
  });
  return { entries, unreadable: 0, broken };
}

/** A bot home as the file system knows it, or as it was given when it is not there. */
function realHome(home) {
  try {
    return realpathSync(home);
  } catch {
    return home;
  }
}

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Whether a figure has every field it should, each a number. */
const complete = (figure, fields) =>
  figure !== undefined && figure !== null
  && fields.every((field) => typeof figure[field] === 'number' && Number.isFinite(figure[field]));

const add = (set, value) => {
  if (typeof value === 'string' && value !== '') set.add(value);
};

/**
 * Whether a moment is in the window: at or after its start, before its end. A
 * record with no time of its own is in no window; it is left out and said to be.
 */
const inside = (when, { from, to }) => when >= from && when < to;

/** When the first and the last counted call of this conversation were. */
function mark(tally, when) {
  if (tally.first === undefined || when < tally.first) tally.first = when;
  if (tally.last === undefined || when > tally.last) tally.last = when;
}
