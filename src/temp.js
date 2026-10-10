// `obk temp make` and `obk temp retire`: a session's own temporary sessions
// (PRD 6.4, #227). And `obk temp trust-hooks` and `obk temp answer`, the
// answers a maker gives its Codex run's hooks review (#238) and its Claude
// session's Teach auto mode form (#489).
//
// Any long-lived session can make a temporary session of its own bot for a
// piece of work, and retire it when the work is done, without Bot Father, who
// stays the manager of long-lived sessions. A temporary session can make one
// of its own, one level deep and one at a time (#464, ADR 0033). It can be
// made in a role of its bot's `temp_roles`, which gives its settings, and
// whose cap limits how many are open (#465). A temporary session is an ordinary
// session in every other way: in bot.yaml, brought up with a tab and a mailbox,
// its conversations kept in the book. What makes it temporary is one field of
// its book entry, `temporary: { maker, made }`, and the book is the one place
// that says so (ADR 0012).
//
// The caller is the session whose tab this runs in, as the book records it: the
// tab says who is calling now. The maker is kept by its session name, not its
// tab, so it still owns what it made after a restart gives it a new tab.
//
// Everything that can refuse is checked before anything is written, so a
// refusal leaves bot.yaml, the book and Orca as they were. The one write that
// may fall outside what a harness's sandbox lets a session write, its start
// prompt's file beside the bots folder, is made first, the way #383 puts the
// risky write before bot.yaml: refused there, nothing else has changed, and the
// same command run again with that access goes through.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { readBook, takeLineTurn, TYPING_HELD, TYPING_WAIT_MS, updateBook } from './book.js';
import { addSession, dropSession, NAME, readBot, tempRoles } from './bot.js';
import { approvalRank, DEFAULT_APPROVAL, harnessOf, isShortPrompt, ownCli, refuseApprovalArgs, shellWord, startPrompt, workDirOf } from './launch.js';
import { sessionInTab } from './message.js';
import { orca, screenRows, tabs } from './orca.js';
import { retireSession } from './retire.js';
import { bringUp, promptPath } from './up.js';

/** The settings a temporary session takes from its maker unless told otherwise. */
const INHERITED = ['model', 'effort', 'context', 'approval'];

/**
 * Make a temporary session of the caller's own bot and bring it up. `given`
 * holds what the caller said: `name`, `prompt` or `prompt_file`, any of
 * `harness` and the inherited settings, and `role`, as `role` or
 * `role:option`, to take the settings that role's option gives in its bot's
 * `temp_roles` (#465). Returns `{ bot, session, maker, settings, chosen,
 * role, up }`: `chosen` says where each setting came from, `role` is there
 * when one was asked for, and `up` is what bringing it up answered.
 */
export async function makeTemp(bots, { tab, ...given }) {
  const caller = callerIn(bots, tab, 'make');
  // Checked here, before anything is written, and again under the book's lock
  // below, where two makes at once cannot both pass it.
  refuseNested(bots, caller, readBook(caller.home));
  const bot = readBot(caller.home, caller.bot);
  const role = given.role === undefined ? undefined : roleAsked(caller, bot, given.role);
  const name = role === undefined ? given.name : roleName(caller, bot, role, given.name);
  // The name is a folder under work/ and a file beside the bots folder, so it
  // is held to the rule a bot's name is: one plain name, never a path.
  if (!NAME.test(name)) {
    throw new Error(`${name} cannot be a session's name: a name is lower-case letters, digits and single hyphens, such as review-250. Nothing was made.`);
  }
  if (given.prompt !== undefined && given.prompt_file !== undefined) {
    throw new Error(`temp make was given the task twice, as --prompt and as --prompt-file, and a session is told its duty once. Give it one way. Nothing was made.`);
  }
  if (given.prompt === undefined && given.prompt_file === undefined && role?.prompt_file === undefined) {
    throw new Error(`temp make needs the task: --prompt <text> or --prompt-file <path>${role === undefined ? '' : `, since the role ${role.name} has no prompt file`}. Nothing was made.`);
  }
  if (role !== undefined) refuseCap(caller, role, readBook(caller.home));

  const maker = bot.sessions.find((session) => session.name === caller.session);
  const { settings, chosen } = settingsFor(bot, maker, role?.option ?? {}, given);
  refuseWiderApproval(bots, caller, bot, maker, given.approval);
  refuseApprovalArgs(chosen.harness.value, given.extra_args);
  settings.name = name;
  if (given.extra_args !== undefined) settings.extra_args = given.extra_args;
  if (given.prompt !== undefined) settings.prompt = given.prompt;
  else settings.prompt_file = given.prompt_file ?? role.prompt_file;
  settings.work_dir = `work/${name}`;

  const written = bot.sessions.some((session) => session.name === name) ? undefined : writePromptFirst(bots, caller, settings);
  // bot.yaml and the book are written under the book's lock, so that a second
  // make from the same maker waits, and then sees this one (#464). addSession
  // refuses a name the bot already has, and a setting that will not work,
  // before it writes anything.
  const made = new Date().toISOString();
  let locked = false;
  let added;
  try {
    await updateBook(caller.home, (book) => {
      locked = true;
      refuseNested(bots, caller, book);
      if (role !== undefined) refuseCap(caller, role, book);
      added = addSession(bots, caller.bot, settings);
      const kind = role === undefined ? {} : { role: role.name, option: role.option.name };
      book.sessions[name] = { ...book.sessions[name], temporary: { maker: caller.session, made, ...kind } };
    });
  } catch (error) {
    // A refusal under the lock has written nothing but the prompt file.
    const refused = locked && added === undefined;
    const failed = `${caller.bot}/${name} could not be recorded in the book as temporary (${error.message})`;
    // A session in bot.yaml that the book does not call temporary would be a
    // long-lived one to everything that reads it, its maker's retire included,
    // so it is taken back off rather than left that way.
    if (added !== undefined) {
      try {
        dropSession(bots, caller.bot, name);
      } catch (undo) {
        throw new Error(`${failed}, and taking it back off bot.yaml failed too (${undo.message}). It is in bot.yaml as a session the book does not call temporary. Take it off with  ${shellWord(ownCli())} retire --bots ${shellWord(bots)} --bot ${caller.bot} --session ${name}`);
      }
    }
    // Off bot.yaml, nothing is made; a prompt file that stays is only a file,
    // and nothing reads it (#393).
    const why = refused ? error.message.replace(/ ?Nothing was made\.$/, '') : `${failed}${added === undefined ? '.' : ', so it was taken back off bot.yaml.'}`;
    try {
      if (written !== undefined) rmSync(written, { force: true });
    } catch (left) {
      throw new Error(`${why} Nothing was made. Its start prompt ${written} could not be removed (${left.message}), and nothing reads it. Remove it with  rm ${shellWord(written)}`);
    }
    if (refused) throw error;
    throw new Error(`${why} Nothing was made. Run this again once the book can be written.`);
  }

  let up;
  try {
    up = await bringUp(bots, { bot: caller.bot, session: name });
  } catch (error) {
    const cli = shellWord(ownCli());
    throw new Error(`${caller.bot}/${name} is made, in bot.yaml and in the book as temporary with its maker ${caller.session}, and could not be brought up: ${error.message} Bring it up with  ${cli} up --bots ${shellWord(bots)} --bot ${caller.bot} --session ${name}  or retire it with  ${cli} temp retire --bots ${shellWord(bots)} --name ${name}`);
  }
  return { bot: caller.bot, session: name, maker: caller.session, settings: added.session, chosen, ...(role === undefined ? {} : { role: roleAnswer(role) }), up };
}

/**
 * The settings a temporary session is made with, and for each of the ones
 * that can be inherited, what it got and where from: `chosen` (#465). A flag
 * wins; then the role's option, on the option's harness, which is the maker's
 * when the option names none; then the maker, on the maker's harness; and
 * otherwise the harness's own default. On another harness than its maker's,
 * only the approval carries over (#238, PRD 6.4).
 */
function settingsFor(bot, maker, option, given) {
  const makers = harnessOf(maker ?? {}, bot.harness);
  const settings = {};
  const chosen = {};
  const pick = (field, ...sources) => {
    // YAML reads a setting written with no value as null, which gives nothing.
    const found = sources.find(([, value]) => value !== undefined && value !== null);
    if (found === undefined) {
      chosen[field] = { from: 'harness default' };
      return;
    }
    chosen[field] = { value: found[1], from: found[0] };
    if (found[0] !== 'maker' || field !== 'harness' || maker?.harness !== undefined) settings[field] = found[1];
  };
  pick('harness', ['flag', given.harness], ['role', option.harness], ['maker', makers]);
  const harness = chosen.harness.value;
  const fromRole = harness === (option.harness ?? makers);
  const same = harness === makers;
  for (const field of INHERITED) {
    pick(
      field,
      ['flag', given[field]],
      ['role', fromRole && field !== 'approval' ? option[field] : undefined],
      ['maker', same || field === 'approval' ? maker?.[field] : undefined],
      // A session's approval is never left to the harness (ADR 0015).
      ['kit default', field === 'approval' ? DEFAULT_APPROVAL : undefined],
    );
  }
  return { settings, chosen };
}

/**
 * Refuse an approval wider than the widest of the maker's own and the bot's
 * `temp_approval`, which only the user's yes through `permission approval
 * --temps` widens (ADR 0037).
 */
function refuseWiderApproval(bots, caller, bot, maker, asked) {
  if (asked === undefined) return;
  const own = maker?.approval ?? DEFAULT_APPROVAL;
  const widest = approvalRank(bot.temp_approval) > approvalRank(own) ? bot.temp_approval : own;
  if (approvalRank(asked) <= approvalRank(widest)) return;
  throw new Error(`--approval ${asked} is wider than ${caller.session}'s own approval, ${own}${widest === own ? '' : `, and than ${caller.bot}'s temp_approval, ${widest}`}, and a session does not widen another's approval. The user allows it for ${caller.bot}'s temporary sessions with  ${shellWord(ownCli())} permission approval --bots ${shellWord(bots)} --bot ${caller.bot} --temps --approval ${asked}. Nothing was made.`);
}

/**
 * The role and option `asked` names, as `role` or `role:option`, from the
 * bot's roles, with the option it takes; or a refusal that names what the bot
 * has to choose from.
 */
function roleAsked(caller, bot, asked) {
  const [name, optionName, ...more] = asked.split(':');
  const roles = tempRoles(caller.home, bot);
  if (roles.length === 0) {
    throw new Error(`${caller.bot} has no roles for temporary sessions: its bot.yaml has no temp_roles. Make it without --role, or give the bot its roles first. Nothing was made.`);
  }
  const role = roles.find((one) => one.name === name);
  if (role === undefined || more.length > 0) {
    throw new Error(`${caller.bot} has no role ${asked}. Its roles are ${roles.map((one) => one.name).join(', ')}; ask for one as --role <role> or --role <role>:<option>. Nothing was made.`);
  }
  if (role.trouble.length > 0) {
    throw new Error(`the role ${name} cannot be used as it is written: ${role.trouble.join(' ')} Nothing was made.`);
  }
  const option = optionName === undefined ? role.options[0] : role.options.find((one) => one.name === optionName);
  if (option === undefined) {
    throw new Error(`the role ${name} has no option ${optionName}. Its options are ${optionsLine(optionsOf(role))}. Nothing was made.`);
  }
  return { ...role, option };
}

/**
 * The name of a session made in `role`: `--name` as given when it already
 * begins with the role, or with the role put in front. A name that begins with
 * another of the bot's roles would say the wrong one, and is refused.
 */
function roleName(caller, bot, role, given) {
  if (given.startsWith(`${role.name}-`)) return given;
  const other = tempRoles(caller.home, bot).find((one) => given.startsWith(`${one.name}-`));
  if (other !== undefined) {
    throw new Error(`${given} begins with ${other.name}-, the name of another of ${caller.bot}'s roles, and a session made in ${role.name} is named for ${role.name}. Give --name without it, such as --name ${given.slice(other.name.length + 1)}, to make ${role.name}-${given.slice(other.name.length + 1)}. Nothing was made.`);
  }
  return `${role.name}-${given}`;
}

/** Refuse a make in a role whose cap of open sessions is reached, against `book` (#465). */
function refuseCap(caller, role, book) {
  if (role.cap === undefined) return;
  const open = Object.keys(book.sessions).filter((name) => book.sessions[name]?.temporary?.role === role.name);
  if (open.length >= role.cap) {
    throw new Error(`the role ${role.name} has a cap of ${role.cap} open temporary sessions, and ${caller.bot} has ${open.length} open: ${open.join(', ')}. Retire one whose work is done first. Nothing was made.`);
  }
}

/** A role's options as an answer gives them: each one's name, what it is for, and whether it is the default. */
const optionsOf = (role) => role.options.map((option, at) => ({ name: option.name, ...(option.for === undefined ? {} : { for: option.for }), default: at === 0 }));

/** Options as `optionsOf` gives them, on one line. */
export const optionsLine = (options) => options
  .map((option) => `${option.name}${option.default ? ' (the default)' : ''}${option.for === undefined ? '' : `, for ${option.for}`}`)
  .join('; ');

/** A role as an answer gives it: the option used, and every option the role has. */
const roleAnswer = (role) => ({
  name: role.name,
  option: role.option.name,
  ...(role.option.for === undefined ? {} : { for: role.option.for }),
  options: optionsOf(role),
});

/**
 * The roles of the caller's bot, each with its cap, its open temporary
 * sessions, its prompt file and its options, the first the default (#465).
 * Returns `{ bot, roles }`.
 */
export function listRoles(bots, { tab }) {
  const caller = callerIn(bots, tab, 'roles', 'list the roles');
  const book = readBook(caller.home);
  const roles = tempRoles(caller.home, readBot(caller.home, caller.bot)).map((role) => ({
    name: role.name,
    ...(role.cap === undefined ? {} : { cap: role.cap }),
    open: Object.keys(book.sessions).filter((name) => book.sessions[name]?.temporary?.role === role.name),
    ...(role.prompt_file === undefined ? {} : { prompt_file: role.prompt_file }),
    options: role.options.map((option, at) => ({ ...option, default: at === 0 })),
    ...(role.trouble.length === 0 ? {} : { trouble: role.trouble }),
  }));
  return { bot: caller.bot, roles };
}

/**
 * Refuse a make by a temporary session that may not make one now, against
 * `book`: one made by a temporary session makes none, and a temporary session
 * has one of its own open at a time (#464, ADR 0033).
 */
function refuseNested(bots, caller, book) {
  if (caller.temporary === undefined) return;
  const maker = caller.temporary.maker;
  if (book.sessions[maker]?.temporary !== undefined) {
    throw new Error(`${caller.bot}/${caller.session} is a temporary session ${maker} made, and ${maker} is temporary itself, so it makes none of its own: temporary sessions go one level deep. Nothing was made.`);
  }
  const open = Object.keys(book.sessions).filter((name) => book.sessions[name]?.temporary?.maker === caller.session);
  if (open.length > 0) {
    throw new Error(`${caller.bot}/${caller.session} is a temporary session, and it already has ${open.join(', ')} open; a temporary session has one of its own at a time. Retire it first with  ${shellWord(ownCli())} temp retire --bots ${shellWord(bots)} --name ${open[0]}  Nothing was made.`);
  }
}

/**
 * Write the start prompt's file where bringing the session up will write it,
 * when its prompt goes to the harness out of a file at all, and say where. A
 * prompt that cannot be read yet is left to `addSession`, which refuses it in
 * its own words.
 */
function writePromptFirst(bots, caller, settings) {
  let prompt;
  try {
    prompt = startPrompt(settings, { home: caller.home, workDir: workDirOf(settings, caller.home) });
  } catch {
    return undefined;
  }
  if (isShortPrompt(prompt)) return undefined;

  const file = promptPath(bots, caller.bot, settings.name);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, prompt);
  } catch (error) {
    throw new Error(`${caller.bot}/${settings.name}'s start prompt could not be written to ${file} (${error.message}), and it is written first, so nothing was made. Run this again where that folder can be written: from a harness's sandbox, with the access to write it.`);
  }
  return file;
}

/**
 * Retire a temporary session the caller made. Returns what `retireSession`
 * does, with the maker.
 */
export async function retireTemp(bots, { tab, name }) {
  const caller = callerIn(bots, tab, 'retire');
  ownTemp(caller, name, 'retire', 'Nothing was retired.');
  return { ...(await retireSession(bots, { bot: caller.bot, session: name })), maker: caller.session };
}

/**
 * The caller's own temporary session `name`, from bot.yaml, or a refusal: one
 * the bot does not have, a long-lived one, or one another session made.
 * `verb` finishes "to <verb>", and `nothing` is the sentence that ends each.
 */
function ownTemp(caller, name, verb, nothing) {
  const bot = readBot(caller.home, caller.bot);
  const session = bot.sessions.find((one) => one.name === name);
  if (session === undefined) {
    throw new Error(`${caller.bot} has no session called ${name}, so there is nothing of yours to ${verb}. ${nothing}`);
  }
  const temporary = readBook(caller.home).sessions[name]?.temporary;
  if (temporary === undefined) {
    throw new Error(`${caller.bot}/${name} is a long-lived session, and those are Bot Father's to ${verb}. ${nothing}`);
  }
  if (temporary.maker !== caller.session) {
    throw new Error(`${caller.bot}/${name} is a temporary session ${temporary.maker} made, not ${caller.session}, so it is ${temporary.maker}'s to ${verb}. ${nothing}`);
  }
  return { bot, session };
}

/** Codex's hooks review, and the one of its choices this kit answers it with (tech notes, section 3). */
const HOOKS_REVIEW = 'Hooks need review';
const TRUST_ALL = 'Trust all and continue';

/** How long the review is given to go once answered, looked at every half second. */
const REVIEW_GONE_MS = 5000;

/**
 * Answer the hooks review of a Codex run the caller made with "Trust all and
 * continue", and confirm the review went (#238, the owner's choice (b)). The
 * one answer a permission rule of its own can allow: a raw `orca terminal
 * send` cannot be narrowed to a tab or to these keys. Everything that can
 * refuse is checked before a key is sent. Returns `{ bot, session, maker }`.
 */
export async function trustHooks(bots, { tab, name }) {
  const caller = callerIn(bots, tab, 'trust-hooks', "answer a run's hooks review");
  const nothing = 'Nothing was typed.';
  const { bot, session } = ownTemp(caller, name, 'answer for', nothing);
  const run = `${caller.bot}/${name}`;
  const harness = harnessOf(session, bot.harness);
  if (harness !== 'codex') {
    throw new Error(`${run} runs on ${harness}, and temp trust-hooks answers a Codex run's "${HOOKS_REVIEW}" alone. ${nothing}`);
  }
  await answerScreen(caller, name, {
    what: 'hooks review',
    mark: HOOKS_REVIEW,
    done: `"${TRUST_ALL}" was chosen on its hooks review`,
    answer(rows, { send }) {
      const keys = keysToTrustAll(rows);
      if (keys === undefined) {
        throw new Error(`${run}'s screen shows no "${HOOKS_REVIEW}" with its choices, so there is nothing for this to answer. It shows: ${shown(rows)}. ${nothing}`);
      }
      send(keys);
    },
  });
  return { bot: caller.bot, session: name, maker: caller.session };
}

/**
 * The keys that take Codex's hooks review to "2. Trust all and continue" and
 * answer it, from wherever its pointer is: arrows, then return, never a digit
 * (a digit and return once took whatever was highlighted). Undefined when the
 * rows show no such review with the pointer on one of its choices.
 */
function keysToTrustAll(rows) {
  if (!rows.some((row) => row.includes(HOOKS_REVIEW))) return undefined;
  if (!rows.some((row) => new RegExp(`^ *(?:› +)?2\\. ${TRUST_ALL}`).test(row))) return undefined;
  const pointer = rows.map((row) => /^ *› +(\d+)\. /.exec(row)).findLast((found) => found !== null);
  if (pointer === undefined) return undefined;
  const moves = 2 - Number(pointer[1]);
  return (moves > 0 ? '\x1b[B'.repeat(moves) : '\x1b[A'.repeat(-moves)) + '\r';
}

/** What a screen shows, on one line: its rows with words in them, cut short. */
function shown(rows) {
  const text = rows.map((row) => row.trim()).filter((row) => row !== '').join(' ⏎ ');
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/**
 * Answer a screen of `name`, a temporary session the caller made: under the
 * session's turn for a line (#482), read its screen and hand it to
 * `answer(rows, { send, look })`, which sends keys with `send`, may read the
 * screen again with `look`, and throws when the screen is not its to answer.
 * Then wait for `mark` to leave the screen. `what` names the screen and `done`
 * says what was sent, for the sentences that refuse or fail; `done` may be a
 * function of what `answer` returned.
 */
async function answerScreen(caller, name, { what, mark, done, answer }) {
  const run = `${caller.bot}/${name}`;
  const nothing = 'Nothing was typed.';
  const tabId = readBook(caller.home).sessions[name]?.tab;
  const handle = tabId === undefined ? undefined : tabs(caller.home).find((one) => one.tabId === tabId)?.handle;
  if (handle === undefined) {
    throw new Error(`${run} has no tab open in Orca, so there is no ${what} of its to answer. ${nothing}`);
  }
  const turn = takeLineTurn(caller.home, name, TYPING_WAIT_MS);
  if (turn === undefined) throw new Error(`${run}: ${TYPING_HELD}.`);
  let answered;
  try {
    const seen = screenRows(handle);
    if (seen.rows === undefined) {
      throw new Error(`${run}'s screen could not be read (${seen.unreadable}), so the kit cannot tell whether its ${what} is there. ${nothing}`);
    }
    answered = answer(seen.rows, {
      // The return, where there is one, is inside the text: `--enter` would be a second key.
      send: (keys) => orca(['terminal', 'send', '--terminal', handle, '--text', keys]),
      look: () => screenRows(handle),
    });
  } finally {
    turn.release();
  }
  for (let waited = 0; ; waited += 500) {
    const after = screenRows(handle);
    if (after.rows !== undefined && !after.rows.some((row) => row.includes(mark))) return answered;
    if (waited >= REVIEW_GONE_MS) {
      const still = after.rows === undefined ? `its screen could not be read again (${after.unreadable})` : `its screen still shows "${mark}"`;
      throw new Error(`${run}: ${typeof done === 'function' ? done(answered) : done}, but ${REVIEW_GONE_MS / 1000} seconds later ${still}. Look at its tab.`);
    }
    await pause(500);
  }
}

/** The title of Claude Code's "Teach auto mode" screen, in each known shape. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/** The foot that ends a Claude Code form, below which its input box sits. */
const TEACH_FOOT = /Enter to .*· Esc to cancel/;

/**
 * The known shapes of the Teach screen, from its title to its foot, each as
 * captured live, with what answers it. Rows are compared trimmed, the pointer
 * `❯` taken out, so the pointer may sit on any one of them.
 *
 * Claude Code 2.1.283's form (#261's live test, #416) is answered with Esc,
 * which cancels it (Not now), never a return, which is Continue. Claude Code
 * 2.1.289's numbered list (#489's live run 1) is answered with "2. Not now",
 * never "1. Yes" or "3. Don't show again" (the architect's ruling on #489).
 */
const TEACH_SHAPES = [
  {
    name: 'the 2.1.283 form',
    rows: [
      TEACH_TITLE,
      'Claude Code reads this project, your recent Claude sessions, and optionally your shell history and other',
      'repositories. Claude analyzes this data and customizes auto mode to make better decisions.',
      'How you use Claude here     Mixed',
      'Also scan shell history     true',
      'Also scan your other repos  false',
      'Continue',
      '←/→ to change usage · Enter to continue · Esc to cancel',
    ],
  },
  {
    name: 'the 2.1.289 list',
    rows: [
      TEACH_TITLE,
      'Auto mode works better when it knows your environment. Takes about a minute.',
      '1. Yes',
      '2. Not now',
      "3. Don't show again",
      'Enter to confirm · Esc to cancel',
    ],
  },
];

/** The 2.1.289 list's choice this kit takes, and the row it is on. */
const NOT_NOW_CHOICE = '2. Not now';

/** A row as a shape is compared: trimmed, with its pointer, wherever it sits, taken out. */
const unpointed = (row) => row.replace('❯', ' ').trim();

/** The full-width rule Claude Code draws right above the screen's title: `─` in 2.1.289, `▔` in 2.1.283. */
const ABOVE_TITLE = /^(?:─+|▔+)$/;

/**
 * The Teach screen on `rows`, from its title to its foot, the rows below the
 * foot (the input box) left out: `{ shape, block }` when its non-blank rows
 * are one known shape's, in its order and nothing else, with the pointer on
 * exactly one; otherwise `{ misfit }`, why not.
 *
 * It counts only in the frame Claude Code drew it in, in both live captures:
 * a full-width rule as the non-blank row right above the title, and, right
 * below the foot, nothing or the input box's top rule. A quote of the screen
 * in a turn, with the turn's own rows around it, is refused (the review of
 * #490). A quote of the frame as well would still look the same: the frame
 * narrows what passes, and is no proof that the screen is live.
 */
function teachScreen(rows) {
  const from = rows.findIndex((row) => row.trim() === TEACH_TITLE);
  if (from < 0) return { misfit: `it shows no "${TEACH_TITLE}"` };
  const foot = rows.findIndex((row, at) => at > from && TEACH_FOOT.test(row));
  if (foot < 0) return { misfit: `it shows "${TEACH_TITLE}" with no foot row ending "Esc to cancel" under it` };
  const above = rows.slice(0, from).findLast((row) => row.trim() !== '');
  if (above === undefined || !ABOVE_TITLE.test(above.trim())) {
    return { misfit: `the row right above its title is ${above === undefined ? 'nothing' : `"${above.trim()}"`}, not the full-width rule Claude Code draws there` };
  }
  const below = rows.slice(foot + 1).find((row) => row.trim() !== '');
  if (below !== undefined && !below.trimStart().startsWith('─')) {
    return { misfit: `the row right below its foot is "${below.trim()}", not the top rule of the input box` };
  }
  const block = rows.slice(from, foot + 1).filter((row) => row.trim() !== '');
  const misfits = TEACH_SHAPES.map((shape) => {
    const pointers = block.filter((row) => row.includes('❯')).length;
    if (pointers !== 1) return `${pointers} rows with the pointer ❯, where ${shape.name} has one`;
    const odd = block.find((row) => !shape.rows.includes(unpointed(row)));
    if (odd !== undefined) return `a row ${shape.name} does not have: ${odd.trim()}`;
    const missing = shape.rows.find((row) => !block.map(unpointed).includes(row));
    if (missing !== undefined) return `no row ${missing}, which ${shape.name} has`;
    if (block.length !== shape.rows.length) return `${block.length} rows, where ${shape.name} has ${shape.rows.length}`;
    const moved = block.findIndex((row, at) => unpointed(row) !== shape.rows[at]);
    if (moved >= 0) return `the row ${block[moved].trim()} where ${shape.name} has ${shape.rows[moved]}`;
    return undefined;
  });
  const fits = misfits.findIndex((misfit) => misfit === undefined);
  if (fits >= 0) return { shape: TEACH_SHAPES[fits], block };
  return { misfit: `its Teach screen is no shape the kit knows: it has ${misfits.join('; and it has ')}` };
}

/** The whole screen, a row to a line: what decides is often at its foot. */
const wholeScreen = (rows) => rows.filter((row) => row.trim() !== '').map((row) => `    ${row}`).join('\n');

/**
 * Answer the first-run screen of a temporary session the caller made (#489):
 * Claude Code's Teach auto mode screen, in one of the shapes the kit knows,
 * matched exactly. The 2.1.283 form gets Esc. The 2.1.289 list gets arrows to
 * "2. Not now" where needed, a second look that the pointer is there and the
 * list is otherwise as it was, and only then a return. Anything else is refused with
 * nothing typed. Like `trustHooks`, it is one command a permission rule of its
 * own can allow. Returns `{ bot, session, maker, sent }`, `sent` saying what
 * answered it.
 */
export async function answerTemp(bots, { tab, name }) {
  const caller = callerIn(bots, tab, 'answer', "answer a session's first-run screen");
  const nothing = 'Nothing was typed.';
  ownTemp(caller, name, 'answer for', nothing);
  const run = `${caller.bot}/${name}`;
  const sent = await answerScreen(caller, name, {
    what: `"${TEACH_TITLE}"`,
    mark: TEACH_TITLE,
    done: (said) => `${said} was sent to its Teach auto mode screen`,
    answer(rows, { send, look }) {
      const seen = teachScreen(rows);
      if (seen.misfit !== undefined) {
        const hooks = rows.some((row) => row.includes(HOOKS_REVIEW)) ? ` A Codex run's "${HOOKS_REVIEW}" is answered with temp trust-hooks.` : '';
        throw new Error(`${run}'s screen is not one temp answer answers: ${seen.misfit}.${hooks} ${nothing} It shows:\n${wholeScreen(rows)}`);
      }
      if (seen.shape === TEACH_SHAPES[0]) {
        send('\x1b');
        return 'Esc (Not now)';
      }
      const at = seen.block.findIndex((row) => row.includes('❯'));
      const moves = seen.block.findIndex((row) => unpointed(row) === NOT_NOW_CHOICE) - at;
      if (moves !== 0) send(moves > 0 ? '\x1b[B'.repeat(moves) : '\x1b[A'.repeat(-moves));
      // The guard, before every return, arrows or none: the list again, its
      // rows in the same order (an exact shape), and the pointer on "2. Not now".
      const again = look();
      const now = again.rows === undefined ? { misfit: `it could not be read again (${again.unreadable})` } : teachScreen(again.rows);
      const on = now.block?.find((row) => row.includes('❯'));
      if (now.shape !== seen.shape || unpointed(on) !== NOT_NOW_CHOICE) {
        const why = now.misfit ?? `its pointer is on ${unpointed(on)}, not ${NOT_NOW_CHOICE}`;
        const sent = moves === 0 ? 'Nothing was typed' : `The arrows to "${NOT_NOW_CHOICE}" went in`;
        throw new Error(`${run}: ${sent}, but then ${why}, so no return was sent. Look at its tab.${again.rows === undefined ? '' : ` It shows:\n${wholeScreen(again.rows)}`}`);
      }
      send('\r');
      return `"${NOT_NOW_CHOICE}"`;
    },
  });
  return { bot: caller.bot, session: name, maker: caller.session, sent };
}

/**
 * The session this runs in, as the book knows it, with its home and whether it
 * is itself temporary.
 */
function callerIn(bots, tab, what, doing = `${what} it`) {
  const found = tab === undefined ? undefined : sessionInTab(bots, tab);
  if (found === undefined) {
    throw new Error(`temp ${what} is run by a session in its own tab, and this is not one of the fleet's tabs, so there is no session here to ${doing} for. Nothing was done.`);
  }
  const entry = readBook(found.home).sessions[found.session] ?? {};
  return { bot: found.bot, session: found.session, home: found.home, temporary: entry.temporary };
}
