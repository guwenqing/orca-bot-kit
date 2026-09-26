// The daily grooming run (PRD 6.8): an optional pass that reads what the bots
// have been doing, works out what it cost, and tells Bot Father.
//
// It runs on Claude Code's own scheduler, in a session of Bot Father's called
// `grooming`, because the owner decided that scheduled work does not use an
// Orca automation: an automation cannot carry a model or an effort of its own,
// and a session's launch line can (#223). The user adds that session like any
// other, with the model and effort it is to run at, and brings it up; the kit
// never makes, starts or closes it.
//
// So the kit schedules nothing itself. The job is the session's: its own
// `CronCreate`, which lives only in that conversation and only while its tab is
// up, comes back on a resume, and is gone after a `/clear` (tech notes,
// section 2). The kit reads which grooming jobs there are out of the
// conversation's transcript, and when asked it types one line into the
// grooming tab: schedule, unschedule, run once, or compact. It keeps no copy of
// what is scheduled, so what it reports is what the conversation holds.
//
// A line typed into the tab is run when the session gets to it, which may be
// after the kit has typed another, so what the kit read from the transcript
// when it typed can be out of date: an `--on` not yet run leaves no job to see.
// So the lines that schedule and unschedule say what the schedule is to be
// rather than what to change: when the session runs one, it looks at what it
// has itself (CronList), removes every grooming job, and then makes the one
// asked for, or none. Run in any order, the last one typed is what holds
// (review of PR #322).
//
// Claude Code ends a recurring job a week after it was made, so the job's own
// prompt ends by renewing it. A renewal that fails either way shows here: no
// job means the fleet has quietly stopped being groomed, two mean it is groomed
// twice, and both are said plainly.

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { botDir, readBot, requireBotsFolder } from './bot.js';
import { readBook } from './book.js';
import { claudeTranscript } from './conversations.js';
import { harnessOf, ownCli, shellWord } from './launch.js';
import { tabs, tabToTypeInto, typeIntoTab } from './orca.js';
import { BOT_FATHER } from './up.js';
import { lines } from './usage.js';

/** Bot Father's session the grooming runs in. */
export const GROOMING = 'grooming';

/** A time of day, as a person writes one. */
const AT = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A daily cron as the kit writes one: minute, hour, every day. */
const DAILY = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;

/** How long Claude Code keeps a recurring job after it was made (tech notes, section 2). */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What the session looks for in its own CronList to find its grooming jobs.
 * Only the start of the marker: CronList shows a prompt cut short, and the
 * grooming session is one Bot Father's, so its jobs are all this fleet's.
 */
const PREFIX = 'obk grooming';

/** How long Orca is given to say what is in the grooming tab. */
const LOOK_MS = 2000;

/**
 * What every grooming job's prompt starts with, which is how the kit and the
 * session tell it from a job of the user's own in the same conversation.
 */
export const markerOf = (bots) => `obk grooming for ${bots}`;

/**
 * Say what the grooming is, and ask the grooming session for a change when
 * told to. `ask` is one of `on`, `move` (a new time for grooming that is on),
 * `off`, `now` and `compact`, or undefined to only report; `at` is a time of
 * day, `HH:MM`.
 *
 * Returns `{ session, jobs, asked }`: the grooming session as the book has it
 * (or null), the grooming jobs alive in its conversation as the command found
 * them, before anything it typed was done, and what it typed (or null).
 */
export function grooming(bots, { at, ask } = {}) {
  requireBotsFolder(bots);

  // The folder as the file system knows it: Claude Code files a transcript
  // under the real path, and Orca knows a tab's project by it.
  const home = realHome(botDir(bots, BOT_FATHER));
  if (!existsSync(path.join(home, 'bot.yaml'))) {
    throw new Error(`there is no ${BOT_FATHER} in ${bots}, and the grooming runs in a session of its. Run obk init first.`);
  }
  if (at !== undefined && !AT.test(at)) {
    throw new Error(`--at is a time of day as 24 hours, such as 04:00, and got: ${at}`);
  }

  const bot = readBot(home, BOT_FATHER);
  const found = bot.sessions.find((one) => one.name === GROOMING);
  const entry = readBook(home).sessions[GROOMING] ?? {};
  const tab = typeof entry.tab === 'string' ? entry.tab : undefined;
  const conversation = typeof entry.session === 'string' ? entry.session : null;

  const session = found === undefined ? null : {
    name: GROOMING,
    harness: harnessOf(found, bot.harness),
    up: tab !== undefined && tabs(home).some((one) => one.tabId === tab),
    conversation,
  };
  const jobs = session?.harness === 'claude' && conversation !== null
    ? groomingJobs(lines(claudeTranscript(home, conversation)), markerOf(bots), Date.now())
    : [];

  const line = ask === undefined ? undefined : lineFor(ask, { bots, session, jobs, at });
  if (line !== undefined) typeInto(bots, home, session, tab, line);

  // A move is turning it on at another time, and is typed as one.
  return { session, jobs, asked: line === undefined ? null : (ask === 'move' ? 'on' : ask) };
}

/**
 * The line that asks the grooming session for `ask`, or undefined when there is
 * nothing to ask. Everything that makes the ask impossible refuses here, before
 * Orca is asked for anything.
 */
function lineFor(ask, { bots, session, jobs, at }) {
  // Nothing to turn off is an answer, unless a session is there to be told: an
  // `--on` typed a moment ago may still be waiting in its tab.
  if (ask === 'off' && jobs.length === 0 && !(session?.harness === 'claude' && session.up)) return undefined;
  if (session === null) {
    throw new Error(`${BOT_FATHER} has no ${GROOMING} session, so there is nothing to ask. Add it: ${addCommand(bots)}, then ${upCommand(bots)}.`);
  }
  if (session.harness !== 'claude') {
    throw new Error(`${BOT_FATHER}'s ${GROOMING} session runs on ${session.harness}, and grooming runs on Claude Code's own schedule, so its session has to be a Claude Code one. Retire it and add it again: ${retireCommand(bots)}, then ${addCommand(bots)} --harness claude.`);
  }

  if (ask === 'off') return offLine(jobs);
  if (ask === 'now') return nowLine(bots);
  if (ask === 'compact') return '/compact';

  if (ask === 'move' && jobs.length === 0) {
    throw new Error(`grooming is off, so there is no job to move. Turning it on at that time is ${groomCommand(bots)} --on --at ${at}, once the user has said yes.`);
  }

  // On: at the time given, or at the one time every job there already has.
  const times = [...new Set(jobs.map((job) => job.at))];
  const when = at ?? (times.length === 1 ? times[0] : undefined);
  if (when === undefined) {
    throw new Error(jobs.length === 0
      ? `grooming is off, so there is no time to keep. Say when: ${groomCommand(bots)} --on --at <HH:MM>.`
      : `the grooming jobs there run at different times (${times.join(', ')}). Say which one to keep: ${groomCommand(bots)} --on --at <HH:MM>.`);
  }
  return onLine(bots, cronOf(when), jobs);
}

/**
 * Type `line` into the grooming tab, through the kit's one gate for typing into
 * a running session: nothing goes into a tab with something on screen waiting
 * for an answer, or with anything but Claude Code in front of it.
 */
function typeInto(bots, home, session, tab, line) {
  if (!session.up) {
    throw new Error(`${BOT_FATHER}'s ${GROOMING} session is not up, so nothing was typed. Bring it up with ${upCommand(bots)}, then run this again.`);
  }
  const found = tabToTypeInto(home, tab, LOOK_MS);
  if (found.blocked !== undefined) {
    throw new Error(`the ${GROOMING} tab is waiting for an answer (${found.blocked}), so nothing was typed. Answer it in the tab, then run this again.`);
  }
  if (found.unsure !== undefined) throw new Error(`the ${GROOMING} tab: ${found.unsure}.`);
  if (found.handle === undefined || found.agent !== 'claude') {
    throw new Error(`the ${GROOMING} tab has no Claude Code in front of it, so nothing was typed. Bring it back with ${restartCommand(bots)}, then run this again.`);
  }
  typeIntoTab(found.handle, line);
}

/**
 * The grooming jobs alive in a conversation's transcript at `now`, oldest
 * first: `{ id, at, cron, made, expires }`.
 *
 * A job is made by a CronCreate that succeeded, recurring (Claude Code's
 * default), with a prompt that starts with the marker. It ends at a CronDelete
 * of its id that succeeded, or a week after it was made. A call is matched to
 * its answer by the tool call's id; an answer that failed is a string, not the
 * job, and makes or ends nothing.
 */
export function groomingJobs(entries, marker, now) {
  const calls = new Map();
  const alive = new Map();
  for (const entry of entries) {
    const content = Array.isArray(entry.message?.content) ? entry.message.content : [];
    for (const item of content) {
      if (entry.type === 'assistant' && item?.type === 'tool_use') calls.set(item.id, item);
      if (entry.type !== 'user' || item?.type !== 'tool_result' || item.is_error === true) continue;

      const call = calls.get(item.tool_use_id);
      const result = entry.toolUseResult;
      if (call === undefined || result === null || typeof result !== 'object' || typeof result.id !== 'string') continue;
      if (call.name === 'CronDelete') alive.delete(result.id);
      if (call.name !== 'CronCreate') continue;

      const { cron, prompt, recurring } = call.input ?? {};
      const made = Date.parse(entry.timestamp ?? '');
      if (recurring === false || typeof prompt !== 'string' || !prompt.startsWith(marker) || Number.isNaN(made)) continue;
      alive.set(result.id, { id: result.id, at: timeOf(cron), cron, made, expires: made + WEEK_MS });
    }
  }
  return [...alive.values()]
    .filter((job) => job.expires > now)
    .sort((left, right) => left.made - right.made)
    .map((job) => ({ ...job, made: new Date(job.made).toISOString(), expires: new Date(job.expires).toISOString() }));
}

/** `HH:MM` as the daily cron Claude Code takes: `04:00` is `0 4 * * *`. */
const cronOf = (at) => {
  const [, hour, minute] = AT.exec(at);
  return `${Number(minute)} ${Number(hour)} * * *`;
};

/** A daily cron read back as `HH:MM`, or undefined for any other shape. */
function timeOf(cron) {
  const found = DAILY.exec(String(cron ?? ''));
  if (found === null) return undefined;
  return `${found[2].padStart(2, '0')}:${found[1].padStart(2, '0')}`;
}

/** The grooming run itself: what a job does each day, and what `--now` asks for once. */
const run = (bots) =>
  `${markerOf(bots)}: run the daily grooming for this fleet, with the obk-grooming skill. Fix this `
  + 'run\'s end now and read what has happened since the last run\'s end up to it, '
  + `counting with ${shellWord(ownCli())} usage --since <last end> --until <this end>, and write this `
  + 'end down for the next run. Work out what it cost with obk-finops, keep '
  + 'each bot\'s profile notes, and send one short report to Bot Father\'s '
  + `management session. The kit here is ${shellWord(ownCli())}: run it wherever a skill says obk. `
  + `The bots folder is ${bots}.`;

/**
 * A job's prompt: the run, and then its own renewal, since Claude Code ends a
 * recurring job a week after it was made. The renewal copies the prompt it was
 * fired with, so the job carries itself on; the one that fired is then the
 * older of the two.
 */
const jobPrompt = (bots, cron) =>
  `${run(bots)} When the report is sent, renew this schedule, which Claude Code ends a week after it was made: `
  + `call CronCreate with cron "${cron}", recurring true, and this whole prompt, word for word, as its prompt; `
  + `then call CronList and CronDelete every other job there whose prompt starts with "${PREFIX}".`;

/**
 * The part of a line that clears the grooming jobs the session has when it runs
 * the line, which is not always what the kit saw when it typed it.
 */
const clearing = (jobs) =>
  `call CronList, and call CronDelete on every job there whose prompt starts with "${PREFIX}"`
  + (jobs.length === 0 ? '' : ` (when this was typed they were ${jobs.map((job) => job.id).join(', ')})`);

const onLine = (bots, cron, jobs) =>
  `obk groom asks you to schedule the daily grooming. First ${clearing(jobs)}. `
  + `Then call CronCreate once, with cron "${cron}", recurring true, and as its prompt everything after "Prompt:" `
  + 'at the end of this line, word for word. Do not run the grooming now; say in one line what you scheduled. '
  + `Prompt: ${jobPrompt(bots, cron)}`;

const offLine = (jobs) =>
  `obk groom asks you to turn the daily grooming off: ${clearing(jobs)}. `
  + 'Schedule nothing in their place, and say in one line what you cancelled.';

const nowLine = (bots) => `obk groom asks you to run the daily grooming once, now, and to schedule nothing. ${run(bots)}`;

/** The command that adds the grooming session, for a caller to run. */
export const addCommand = (bots) =>
  `${shellWord(ownCli())} session add --bots ${shellWord(bots)} --bot ${BOT_FATHER} --name ${GROOMING}`;

/** The command that brings Bot Father's sessions up. */
export const upCommand = (bots) => `${shellWord(ownCli())} up --bots ${shellWord(bots)} --bot ${BOT_FATHER}`;

/** This command again, for a caller to add its flags to. */
export const groomCommand = (bots) => `${shellWord(ownCli())} groom --bots ${shellWord(bots)}`;

const retireCommand = (bots) => `${shellWord(ownCli())} retire --bots ${shellWord(bots)} --bot ${BOT_FATHER} --session ${GROOMING}`;

const restartCommand = (bots) => `${shellWord(ownCli())} restart --bots ${shellWord(bots)} --bot ${BOT_FATHER} --session ${GROOMING}`;

/** A bot home as the file system knows it, or as it was given when it is not there. */
function realHome(home) {
  try {
    return realpathSync(home);
  } catch {
    return home;
  }
}
