// The daily grooming run (PRD 6.8): an optional pass that reads what the bots
// have been doing, works out what it cost, and tells Bot Father.
//
// It is an Orca automation rather than a tab in the book, and that is forced by
// how Orca works rather than chosen: an automation can only reuse a session it
// started itself, so it cannot be pointed at a tab the kit made (tech notes,
// section 1). So grooming is the automation's own session, and whatever it has
// to remember between runs lives in files, which is what the profile notes are.
//
// It is created off. It spends tokens every day, and a routine nobody has
// watched should not be running unwatched, so it waits for one explicit yes.
//
// The one thing this must get right is that there is never more than one.
// Orca does not deduplicate an automation by name: asked twice, it makes two,
// and a user with two of these is groomed twice a day for ever. So the kit
// looks for its own before it creates anything, and the looking is by both the
// name it gives its own and the folder it attached it to, because a user's own
// automation can live in the same project and must be left alone.

import { existsSync } from 'node:fs';
import path from 'node:path';

import { botDir, readBot, requireBotsFolder } from './bot.js';
import { readBook } from './book.js';
import { orca } from './orca.js';
import { BOT_FATHER } from './up.js';

/** What the kit calls its own grooming automation. */
const NAME = 'obk grooming';

/** A time of day, as a person writes one. */
const AT = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** What the automation's session is told to do when it wakes. */
const prompt = (bots) =>
  'Run the daily grooming for this fleet, with the obk-grooming skill. Read what '
  + 'has happened since the last run, work out what it cost with obk-finops, keep '
  + 'each bot\'s profile notes, and send one short report to Bot Father\'s '
  + `management session. The bots folder is ${bots}.`;

/**
 * Say what the grooming is, and make it so when asked.
 * Returns `{ exists }`, and `{ exists, enabled, at, id }` once there is one.
 *
 * Reading and setting are one command because they are one question: a caller
 * that has just moved the time wants to be told what it is now, and what it is
 * now is whatever Orca says rather than whatever the kit last asked for.
 */
export function grooming(bots, { at, on } = {}) {
  requireBotsFolder(bots);

  const home = botDir(bots, BOT_FATHER);
  if (!existsSync(path.join(home, 'bot.yaml'))) {
    throw new Error(`there is no ${BOT_FATHER} in ${bots}, and the grooming runs in its Orca project. Run obk init first.`);
  }
  if (at !== undefined && !AT.test(at)) {
    throw new Error(`--at is a time of day as 24 hours, such as 04:00, and got: ${at}`);
  }

  const bot = readBot(home, BOT_FATHER);
  const book = readBook(home);
  if (book.orca.project === undefined) {
    throw new Error(`${BOT_FATHER} has no Orca project yet, so there is nothing for the grooming to run in. Run obk up --bots ${bots} --bot ${BOT_FATHER} first.`);
  }

  let mine = ours(home);

  if (mine === undefined && at !== undefined) {
    orca([
      'automations', 'create',
      '--name', NAME,
      '--provider', bot.harness,
      '--trigger', 'daily',
      '--time', at,
      '--prompt', prompt(bots),
      '--workspace', `path:${home}`,
      '--workspace-mode', 'existing',
      // Off, whatever else was asked for: turning it on is a separate decision
      // and is made below, so that the one path into "it runs daily" is the
      // same whether it was made just now or a month ago.
      '--disabled',
    ]);
    mine = ours(home);
  } else if (mine !== undefined && at !== undefined && at !== timeOf(mine)) {
    // Orca refuses a time on its own, so the trigger goes with it every time.
    orca(['automations', 'edit', '--id', mine.id, '--trigger', 'daily', '--time', at]);
  }

  if (on !== undefined && mine !== undefined) {
    orca(['automations', 'edit', '--id', mine.id, on ? '--enabled' : '--disabled']);
  }

  // Asked again rather than assumed: the user can move it or switch it in
  // Orca's own interface, and what this prints has to be what is there.
  const now = ours(home);
  return now === undefined
    ? { exists: false }
    : { exists: true, enabled: now.enabled === true, at: timeOf(now), id: now.id };
}

/**
 * The kit's own grooming automation for this Bot Father, if there is one.
 *
 * Both halves are needed. The folder alone would adopt whatever the user set up
 * in the same project, and the name alone would collide across two bots folders
 * on one machine, which each have a Bot Father of their own.
 */
function ours(home) {
  const listed = orca(['automations', 'list']).automations ?? [];
  return listed.find((one) => one?.name === NAME && one?.runContext?.path === home);
}

/** When an automation runs, read out of Orca's own recurrence rule. */
function timeOf(automation) {
  const rule = String(automation?.rrule ?? '');
  const hour = /BYHOUR=(\d+)/.exec(rule)?.[1];
  const minute = /BYMINUTE=(\d+)/.exec(rule)?.[1];
  if (hour === undefined || minute === undefined) return undefined;
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}
