#!/usr/bin/env node

// `obk` — the Orca Bot Kit command line. Bot Father's skills call it; a person
// can too. It writes files and reports what it did; it never commits.
//
// The caller is normally an LLM running a setup step, so every command says
// plainly what it made and what still wants looking at, and `--json` gives it
// the same facts to act on.

import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { addSession, changeBot, changeSession, createBot, leadsOutside, readBot, SESSION_FIELDS } from './bot.js';
import { grooming } from './groom.js';
import { checkHealth, orcaSettingFindings } from './health.js';
import { initBots } from './init.js';
import { APPROVALS, HARNESSES, ownCli, shellWord, workDirOf } from './launch.js';
import { checkMail, lookUp, sendMessage } from './message.js';
import { orcaCli, orcaTrouble } from './orca.js';
import { pauseSessions, unpauseSessions } from './pause.js';
import { recordSession, SHELL_ENV, TAB_ENV } from './record.js';
import { restartSessions } from './restart.js';
import { retireBot, retireSession } from './retire.js';
import { readRoster } from './roster.js';
import { buildAgents, buildRules, CODEX_CAP } from './rules.js';
import { addSkill, buildSkills, linkSkills, removeSkill } from './skills.js';
import { addSource, fetchSources } from './sources.js';
import { readUsage } from './usage.js';
import { BOT_FATHER, bringUp } from './up.js';

const USAGE = `obk — Orca Bot Kit.

Usage:
  obk init --bots <path> --harness claude|codex
                            Create your bots folder: a git repo holding your
                            bots' configuration, with Bot Father in it, and
                            open Bot Father in Orca.
  obk bot create --bots <path> --name <bot> --harness claude|codex
                 [--charter <text>]
                            Write a new bot in your bots folder. Nothing is
                            opened in Orca until you run obk up.
  obk session add --bots <path> --bot <bot> --name <session>
                  [--harness claude|codex] [--model <m>] [--effort <e>]
                  [--context <c>] [--approval ${APPROVALS.join('|')}]
                  [--prompt <text> | --prompt-file <path>] [--work-dir <path>]
                  [--extra-arg=<arg>]
                            Add a session to a bot. Anything left out is the
                            harness's own default; approval is auto. A long
                            start prompt lives in a file in the bot home, and
                            --prompt-file names it.
                            A value of your own that starts with a dash is
                            given glued to its flag, so its dashes are not read
                            as ours: --prompt='- a bullet', and
                            --extra-arg=--search, once per extra argument.
  obk bot change --bots <path> --bot <bot> --charter <text>
                            Give a bot a new charter and rebuild its AGENTS.md.
                            A running session reads it when it next starts.
  obk session change --bots <path> --bot <bot> --session <session>
                  [--model <m>] [--effort <e>] [--context <c>]
                  [--approval ${APPROVALS.join('|')}]
                  [--prompt <text> | --prompt-file <path>] [--work-dir <path>]
                  [--extra-arg=<arg>]
                            Change a session's settings. What you leave out
                            stays as it is; a setting given empty, --model=,
                            goes back to the harness's own default. A running
                            session takes the change when it next starts. A
                            session keeps its harness: to move it, retire it
                            and add another.
  obk pause --bots <path> --bot <bot> [--session <name>]
                            Stop a bot, or one of its sessions, for now: close
                            its tabs and have obk up leave it closed. The book
                            keeps its conversations. Like restart, it closes
                            only the tabs your book names, and none whose
                            conversation the book cannot name.
  obk unpause --bots <path> --bot <bot> [--session <name>]
                            Take the pause off and bring it up again, each
                            session with the conversation it was having.
  obk retire --bots <path> --bot <bot> [--session <name>]
                            End a session: close its tab and take it off the
                            bot, keeping its conversations in the book. Or end
                            a bot: close its tabs, remove its Orca project and
                            move its folder to retired/. It will not retire a
                            bot whose Orca project holds a tab your book does
                            not name.
  obk rules build --bots <path> [--bot <bot>]
                            Build every bot's AGENTS.md from its charter and
                            the rule units it carries, or just the one you
                            name. Your own text outside the marked block is
                            kept; a block you edited by hand is reported and
                            never written over. It does not touch Orca.
  obk skills add --bots <path> --bot <bot> --skill <ref>
                            Put one skill on a bot's list. It writes the list
                            and nothing else; obk skills build is what links
                            it. A skill already listed is left as it is.
  obk skills remove --bots <path> --bot <bot> --skill <ref>
                            Take one skill off a bot's list. obk skills build
                            is what takes its link away.
  obk skills build --bots <path> [--bot <bot>]
                            Link every bot's skills into both harnesses, or
                            just the one you name, from the kit, your own
                            skills folder, or any path, and take away a link
                            it made that no list names any more. What you put
                            in a bot's skills directory yourself is left alone
                            and shown as yours. It does not touch Orca.
  obk skills fetch --bots <path> [--source <name>]
                            Clone the online sources skills.yaml lists, beside
                            your bots folder and never inside it, each at the
                            version you pinned, and write down the sha it got.
                            A source already there is left exactly as it is.
  obk skills update --bots <path> [--source <name>]
                            Move a source on to what its ref names now, and
                            write down the new sha. This is the only thing that
                            moves one.
  obk source add --bots <path> --name <name> --repo <url> --ref <ref>
                 [--path <subfolder>]
                            Write down where a shelf of skills online comes
                            from, and which version of it you want. It only
                            writes it down; obk skills fetch is what clones it.
  obk message to --bots <path> --to <bot>[/<session>] [--from <bot>/<session>]
                            Say which road reaches that session and what its
                            address is. Claude to Claude in one approval class
                            is the harness's own messaging; everything else is
                            the Orca mailbox. Nothing is sent.
  obk message send --bots <path> --to <bot>[/<session>] [--from <bot>/<session>]
                   --subject <text> [--text <text> | --text-file <path>]
                   [--thread <id>]
                            Put a message in that session's Orca mailbox and
                            tell its tab to look. A message too long to travel
                            as itself is written to a file beside your bots
                            folder and named in the message. A pair the
                            harness's own messaging reaches is not carried:
                            the address to write to is answered instead.
  obk message check --bots <path> [--bot <bot>] [--session <name>] [--peek]
                            Read what is waiting for a session and mark it
                            read. --peek leaves it unread. Run in a session's
                            own tab, it is that session's mail.
  obk up --bots <path> [--bot <bot>] [--session <name>]
                            Open whatever is missing in Orca, for every bot or
                            for the one you name. It only ever adds; it never
                            closes a tab. A session the book knows the harness
                            session of comes back with its conversation.
  obk restart --bots <path> --bot <bot> [--session <name>]
                            Close a bot's session tabs and open them again,
                            each with the conversation it was having. It is the
                            one command that closes a tab, it closes only the
                            tabs your book names, and it will not close one
                            whose conversation the book cannot name.
  obk health --bots <path> [--bot <bot>]
                            Say what is wrong with your setup: configuration
                            that will not work, a skill that is not where its
                            list says, a session Orca has lost, and what is
                            lying about that no bot owns. It reports and
                            changes nothing; what to do about each line is
                            yours to decide.
  obk roster --bots <path> [--bot <bot>]
                            Say what your fleet is: every bot, its charter, the
                            rules and skills its lists name, and each session
                            with its settings, its tab and the conversation it
                            is in. It reads your files and reports them as they
                            stand; what to make of them is yours.
  obk groom --bots <path> [--at <HH:MM>] [--on | --off]
                            Say whether the daily grooming exists, when it runs
                            and whether it is on, and set it up or change it
                            when you ask. --at makes one, in Bot Father's Orca
                            project. It is made off, because it spends tokens
                            every day: run it by hand once, read what it gives
                            you, then --on.
  obk usage --bots <path> [--bot <bot>] [--session <name>] [--since <time>] [--until <time>]
                            Say what your sessions have used: the conversations
                            each one had, their calls and tokens, the models and
                            efforts they ran at, and how often they were
                            compacted. --since counts the calls made from that
                            moment on, and --until the calls made before that
                            one: a daily run asks from the last run's end up to
                            its own, and the next starts where it stopped, so no
                            call is counted twice. It counts tokens and never
                            money: what a token costs is looked up live by
                            whoever is asking.
  obk session record --bots <path> --bot <bot>
                            For the kit's own hook, not for typing: it reads
                            what the harness says about a session starting on
                            standard input and writes it into the book.
  obk --version             Print the kit's version.
  obk --help                Print this text.

Every command is safe to run again. Most only add what is missing; the ones
that close a tab or take something away say so above.
Add --json to any of them for the same answer as JSON.
`;

/** The commands, and the flags each one cannot do without. */
const COMMANDS = {
  init: ['bots', 'harness'],
  up: ['bots'],
  restart: ['bots', 'bot'],
  pause: ['bots', 'bot'],
  unpause: ['bots', 'bot'],
  retire: ['bots', 'bot'],
  health: ['bots'],
  groom: ['bots'],
  roster: ['bots'],
  usage: ['bots'],
  'bot create': ['bots', 'name', 'harness'],
  'bot change': ['bots', 'bot'],
  'rules build': ['bots'],
  'skills add': ['bots', 'bot', 'skill'],
  'skills remove': ['bots', 'bot', 'skill'],
  'skills build': ['bots'],
  'skills fetch': ['bots'],
  'skills update': ['bots'],
  'source add': ['bots', 'name', 'repo', 'ref'],
  'session add': ['bots', 'bot', 'name'],
  'session change': ['bots', 'bot', 'session'],
  'message to': ['bots', 'to'],
  'message send': ['bots', 'to', 'subject'],
  'message check': ['bots'],
  'session record': ['bots', 'bot'],
};

/** What each flag is for, in the sentence a caller reads when it is missing. */
const NEEDED = {
  bots: '--bots <path>: where your bots folder is',
  name: '--name <name>: what to call it',
  bot: '--bot <bot>: which bot',
  session: '--session <name>: which session',
  source: '--source <name>: which source',
  since: '--since <time>: the moment to count from',
  until: '--until <time>: the moment to count up to, not including it',
  at: '--at <HH:MM>: what time of day it runs',
  skill: "--skill <ref>: which skill, as a bot's list names one",
  repo: '--repo <url>: the repository to clone it from',
  ref: '--ref <ref>: the branch, tag or commit to pin it at',
  path: '--path <subfolder>: where the skills sit inside that repository',
  harness: `--harness ${HARNESSES.join('|')}: which harness it runs on`,
  to: '--to <bot>/<session>: which session to write to',
  from: '--from <bot>/<session>: which session is writing',
  subject: '--subject <text>: what the message is about',
};

/** The flags that name something. A name that is empty names nothing. */
const IDENTIFIERS = Object.keys(NEEDED);

/**
 * The session settings a flag can carry, as `[flag, field]`: every field a
 * session has, spelled with dashes, except the name it is added under and the
 * extra arguments, which come one flag at a time.
 */
const SETTINGS = SESSION_FIELDS
  .filter((field) => field !== 'name' && field !== 'extra_args')
  .map((field) => [field.replaceAll('_', '-'), field]);

function version() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}

async function run(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      bots: { type: 'string' },
      harness: { type: 'string' },
      name: { type: 'string' },
      bot: { type: 'string' },
      session: { type: 'string' },
      source: { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
      at: { type: 'string' },
      on: { type: 'boolean' },
      off: { type: 'boolean' },
      skill: { type: 'string' },
      repo: { type: 'string' },
      ref: { type: 'string' },
      path: { type: 'string' },
      to: { type: 'string' },
      from: { type: 'string' },
      subject: { type: 'string' },
      text: { type: 'string' },
      'text-file': { type: 'string' },
      thread: { type: 'string' },
      peek: { type: 'boolean' },
      charter: { type: 'string' },
      ...Object.fromEntries(SETTINGS.map(([flag]) => [flag, { type: 'string' }])),
      'extra-arg': { type: 'string', multiple: true },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  if (positionals.length === 0) {
    process.stderr.write(USAGE);
    return 1;
  }

  // `bot`, `rules`, `skills`, `session`, `source` and `message` are commands of
  // two words; the rest are one.
  const words = ['bot', 'rules', 'skills', 'session', 'source', 'message'].includes(positionals[0]) ? 2 : 1;
  const command = positionals.slice(0, words).join(' ');
  const extra = positionals.slice(words);

  if (!(command in COMMANDS)) {
    throw new Error(`there is no "${command}" command. Run obk --help to see what there is.`);
  }
  if (extra.length > 0) {
    throw new Error(`${command} takes no other arguments, and got: ${extra.join(' ')}`);
  }
  for (const flag of COMMANDS[command]) {
    if (values[flag] === undefined) throw new Error(`${command} needs ${NEEDED[flag]}.`);
  }
  // A name with nothing in it is a name that was not given, whether the command
  // needs it or not. The settings are not held to this: an empty model or
  // effort is the harness's own, which is what leaving it out means too.
  for (const flag of IDENTIFIERS) {
    if (values[flag] !== undefined && values[flag].trim() === '') {
      throw new Error(`${command} needs ${NEEDED[flag]}.`);
    }
  }
  if (values.harness !== undefined && !HARNESSES.includes(values.harness)) {
    throw new Error(`--harness is ${HARNESSES.join(' or ')}, and got: ${values.harness}`);
  }

  // One fleet, one identity, whatever spelling of its path was given (#164).
  const bots = command === 'init' ? path.resolve(values.bots) : sameFleet(path.resolve(values.bots));
  if (command === RECORD) return record(bots, values.bot);

  const { answer, lines, code = 0 } = await commands[command](bots, values);

  process.stdout.write(values.json ? `${JSON.stringify(answer, null, 2)}\n` : `${lines.join('\n')}\n`);
  return code;
}

/**
 * The bots folder as the file system knows it. A folder reached through a
 * symlink is the same fleet: the harnesses file their transcripts under the real
 * path, Orca records an automation's workspace by it, and what the kit keeps
 * beside the folder (the skill sources, the start prompts, the messages) is
 * named after it. Asked by one spelling and then another, a fleet would
 * otherwise have two of each, and a pin set through one is undone through the
 * other.
 *
 * Every command but `init` from the start. It is given a path that may not exist
 * yet, and when it refuses one it names what the user gave it rather than
 * whatever the link pointed at, which is a file they never mentioned; once the
 * folder is there, it too works on the real path.
 */
function sameFleet(bots) {
  try {
    return realpathSync(bots);
  } catch {
    return bots;
  }
}

/**
 * The line that sends someone to look at a tab, naming the Orca the kit itself
 * talks to rather than the word `orca`.
 *
 * A bare `orca` is not a command everywhere: on this machine it is a root-only
 * symlink and answers that it cannot find the app (tech notes, section 1), and
 * the notes already record a session following this very advice and failing. So
 * what is printed is what the kit would run, which is the only path known to
 * work here.
 *
 * Through the kit's own `shellWord`, because `OBK_ORCA` can point at a path with
 * a space in it, and unquoted the shell reads that as two words and the line
 * fails for a reason that looks nothing like its cause.
 */
const lookAt = (terminal) => `${shellWord(orcaCli())} terminal read --terminal ${terminal} --screen`;

/** The SETUP.md shipped with the running kit, whose section 5 has the answers. */
const SETUP = fileURLToPath(new URL('../SETUP.md', import.meta.url));

/**
 * Who answers a tab left on a screen: the caller, not the user (PRD 6.5). The
 * kit names where the answers are rather than carrying them, because which
 * keys answer which screen is judgment that changes with every harness
 * release, and that belongs in the skill (ADR 0016).
 */
const ANSWER_IT = [
  `             Answer what is on screen yourself, without asking the user: section 5 of ${SETUP}`,
  '             and the obk-bot-building skill have the keys for the usual screens.',
  '             Anything you do not recognise gets no keypress: take it to the user.',
];

/** The one command a harness runs rather than a person: the kit's hook. */
const RECORD = 'session record';

/**
 * What the kit's hook does with what the harness told it, and what it answers.
 *
 * A hook runs inside the user's own session, so this one stays out of the way:
 * it writes on standard output only what the harness is to read as JSON, and
 * whatever goes wrong, it goes wrong quietly. A book left stale is a thing the
 * health check finds later; a session disturbed is the user's work (ADR 0020).
 */
async function record(bots, bot) {
  try {
    const answer = await recordSession(bots, bot, JSON.parse(readFileSync(0, 'utf8')), process.env[TAB_ENV], process.env[SHELL_ENV]);
    if (answer !== undefined) process.stdout.write(`${JSON.stringify(answer)}\n`);
  } catch {
    // Nothing: see above.
  }
  return 0;
}

const commands = {
  async init(bots, values) {
    // Asked before anything is written, so an Orca that is down leaves the disk
    // exactly as it was and the caller can simply run the command again.
    refuseWhenOrcaIsDown();
    const seeded = initBots(bots, values.harness);
    // The typed path was for making the folder and naming it in a refusal; from
    // here on it is the fleet, and the fleet is its real path (#164).
    const { tabs, rules, skills, paused } = await bringUp(sameFleet(seeded.bots), { bot: BOT_FATHER });
    // Setup is the other place the PRD asks for Orca's own launch arguments to
    // be looked at (6.5), and the one where the user is still standing in front
    // of the fleet they are making. Only that one check: a folder init has just
    // made has nothing else to say about itself.
    const answer = { bots: seeded.bots, created: seeded.created, completed: seeded.completed, rules, skills, tabs, paused, found: orcaSettingFindings() };
    return { answer, lines: tabLines(answer, `Bot Father is up in Orca. Your bots folder: ${seeded.bots}`) };
  },

  async up(bots, values) {
    refuseWhenOrcaIsDown();
    const { tabs, rules, skills, paused } = await bringUp(bots, { bot: values.bot, session: values.session });
    const answer = { bots, created: [], completed: [], rules, skills, tabs, paused };
    const up = [...new Set(tabs.map((tab) => tab.bot))];
    const summary = up.length === 0
      ? `Nothing was brought up in Orca. Your bots folder: ${bots}`
      : `Up in Orca: ${up.join(', ')}. Your bots folder: ${bots}`;
    return { answer, lines: tabLines(answer, summary) };
  },

  health(bots, values) {
    refuseWhenOrcaIsDown();
    const found = checkHealth(bots, { bot: values.bot });
    return {
      answer: { bots, found },
      lines: [
        ...foundLines(found),
        found.length === 0
          ? `Nothing to report: everything the kit keeps is where it should be. Your bots folder: ${bots}`
          : `${found.length} thing${found.length === 1 ? '' : 's'} to look at above. What to do about each is yours to decide. Your bots folder: ${bots}`,
      ],
      // Something to look at is not a command that failed, and the answer is
      // printed either way; the code is there for whoever runs it in a script.
      code: found.length === 0 ? 0 : 1,
    };
  },

  async restart(bots, values) {
    refuseWhenOrcaIsDown();
    const { closed, tabs, rules, skills, paused } = await restartSessions(bots, { bot: values.bot, session: values.session });
    const answer = { bots, created: [], completed: [], rules, skills, tabs, paused, closed };
    const what = values.session === undefined ? values.bot : `${values.bot} ${values.session}`;
    return {
      answer,
      lines: [
        ...closed.map((tab) => `closed     ${tab.bot} ${tab.name}  tab ${tab.tabId}  terminal ${tab.terminal}`),
        ...tabLines(answer, `Restarted in Orca: ${what}. Your bots folder: ${bots}`),
      ],
    };
  },

  async pause(bots, values) {
    refuseWhenOrcaIsDown();
    const paused = await pauseSessions(bots, { bot: values.bot, session: values.session });
    const what = values.session === undefined ? values.bot : `${values.bot} ${values.session}`;
    const back = values.session === undefined ? '' : ` --session ${values.session}`;
    return {
      answer: { bots, ...paused },
      lines: [
        ...paused.closed.map((tab) => `closed     ${tab.bot} ${tab.name}  tab ${tab.tabId}  terminal ${tab.terminal}`),
        `${paused.changed ? 'paused' : 'there'.padEnd(6)}     ${what}${paused.changed ? '' : ' was paused already'}`,
        `obk up leaves it closed, and the book keeps its conversations. Bring it back:  ${shellWord(ownCli())} unpause --bots ${shellWord(bots)} --bot ${values.bot}${back}`,
      ],
    };
  },

  async unpause(bots, values) {
    refuseWhenOrcaIsDown();
    const { bot, session, changed, ...up } = await unpauseSessions(bots, { bot: values.bot, session: values.session });
    const what = session === undefined ? bot : `${bot} ${session}`;
    const answer = { bots, bot, session, changed, created: [], completed: [], ...up };
    return {
      answer,
      lines: tabLines(answer, `${changed ? 'Unpaused' : 'Not paused, so brought up as it is'}: ${what}. Your bots folder: ${bots}`),
    };
  },

  async retire(bots, values) {
    refuseWhenOrcaIsDown();
    const closedLines = (closed) => closed.map((tab) => `closed     ${tab.bot} ${tab.name}  tab ${tab.tabId}  terminal ${tab.terminal}`);

    if (values.session !== undefined) {
      const retired = await retireSession(bots, { bot: values.bot, session: values.session });
      return {
        answer: { bots, ...retired },
        lines: [
          ...closedLines(retired.closed),
          `retired    ${retired.bot} ${retired.session}: off ${path.join('bots', retired.bot, 'bot.yaml')}, and its conversations kept in the book under retired`,
        ],
      };
    }

    const retired = await retireBot(bots, { bot: values.bot });
    return {
      answer: { bots, ...retired },
      lines: [
        ...closedLines(retired.closed),
        ...(retired.project === undefined ? [] : [`removed    Orca project ${retired.project}`]),
        `retired    ${retired.bot}: moved to ${path.relative(bots, retired.moved)}, with its book, charter and memory`,
      ],
    };
  },

  'bot create'(bots, values) {
    const made = createBot(bots, { name: values.name, harness: values.harness, charter: values.charter });
    // The bot's AGENTS.md is the rules build's, here as everywhere else, so
    // that a new bot's file and a rebuilt one are written by the same code.
    const rules = [buildAgents(bots, made.home, readBot(made.home))];
    // A new bot is given what the lists already name, so it is whole before
    // anybody opens a tab on it.
    const skills = [linkSkills(bots, made.home, readBot(made.home))];
    const answer = { bots, bot: made.bot, home: made.home, created: made.created, rules, skills };
    // A bot whose rules would not build is made but not finished: it has no
    // instructions, so `up` will not start it, and saying "give it a session"
    // would send the caller past the thing that needs settling first.
    const trouble = rules[0].trouble !== undefined;
    return {
      answer,
      lines: [
        ...made.created.map((entry) => `created    ${entry}`),
        ...rulesLines(rules, bots),
        ...skillsLines(skills),
        trouble
          ? `${made.bot} is written, and its rules are not. Settle what the line above says, then:  ${shellWord(ownCli())} rules build --bots ${shellWord(bots)} --bot ${made.bot}`
          : `${made.bot} is written. Give it a session:  ${shellWord(ownCli())} session add --bots ${shellWord(bots)} --bot ${made.bot} --name <name>`,
      ],
      code: trouble ? 1 : 0,
    };
  },

  'bot change'(bots, values) {
    if (values.harness !== undefined) {
      throw new Error(`bot change does not change a bot's harness: its sessions' conversations belong to the harness they ran on. To move to ${values.harness}, give it a session on ${values.harness} with obk session add, or retire the bot with obk retire and create a new one.`);
    }
    const changed = changeBot(bots, values.bot, { charter: values.charter });
    // Rebuilt at once, as bot create builds it, so the charter a session reads
    // is the one the bot now has.
    const rules = [buildAgents(bots, changed.home, readBot(changed.home))];
    const trouble = rules[0].trouble !== undefined;
    return {
      answer: { bots, bot: changed.bot, home: changed.home, charter: changed.charter, rules },
      lines: [
        `changed    the charter in ${path.join('bots', changed.bot, 'bot.yaml')}`,
        ...rulesLines(rules, bots),
        trouble
          ? `${changed.bot}'s charter is written, and its rules are not. Settle what the line above says, then:  ${shellWord(ownCli())} rules build --bots ${shellWord(bots)} --bot ${changed.bot}`
          : `${changed.bot}'s charter is changed. A session that is running read the old one when it started; it reads this one when it next starts.`,
      ],
      code: trouble ? 1 : 0,
    };
  },

  'skills build'(bots, values) {
    const skills = buildSkills(bots, { bot: values.bot });
    const trouble = skills.filter((entry) => entry.trouble !== undefined);
    return {
      answer: { bots, skills },
      lines: [
        ...skillsLines(skills),
        trouble.length === 0
          ? `Every bot has the skills its lists name. Your bots folder: ${bots}`
          : `${trouble.map((entry) => entry.bot).join(', ')}: skills not linked. Settle what the lines above say, then link again.`,
      ],
      code: trouble.length === 0 ? 0 : 1,
    };
  },

  'skills add'(bots, values) {
    const added = addSkill(bots, values.bot, values.skill);
    return {
      answer: { bots, bot: added.bot, home: added.home, skill: added.skill, state: added.state },
      lines: [
        added.state === 'added'
          ? `added      ${added.skill} to ${path.join('bots', added.bot, 'bot.yaml')}`
          : `there      ${added.skill} is on ${added.bot}'s list already, and nothing was written`,
        `Link it:   ${shellWord(ownCli())} skills build --bots ${shellWord(bots)} --bot ${added.bot}`,
      ],
    };
  },

  'skills remove'(bots, values) {
    const removed = removeSkill(bots, values.bot, values.skill);
    return {
      answer: { bots, bot: removed.bot, home: removed.home, skill: removed.skill, state: removed.state },
      lines: [
        removed.state === 'removed'
          ? `removed    ${removed.skill} from ${path.join('bots', removed.bot, 'bot.yaml')}`
          : `absent     ${removed.skill} is not on ${removed.bot}'s list, and nothing was written`,
        `Unlink it: ${shellWord(ownCli())} skills build --bots ${shellWord(bots)} --bot ${removed.bot}`,
      ],
    };
  },

  'source add'(bots, values) {
    const source = addSource(bots, { name: values.name, repo: values.repo, ref: values.ref, path: values.path });
    return {
      answer: { bots, source },
      lines: [
        `added      source ${source.name} to skills.yaml`,
        ...Object.entries(source)
          .filter(([key]) => key !== 'name')
          .map(([key, value]) => `           ${key.padEnd(5)}  ${value}`),
        `Fetch it:  ${shellWord(ownCli())} skills fetch --bots ${shellWord(bots)} --source ${source.name}`,
      ],
    };
  },

  groom(bots, values) {
    refuseWhenOrcaIsDown();
    if (values.on === true && values.off === true) {
      throw new Error('groom takes --on or --off, and got both. Say which one you want.');
    }
    const on = values.on === true ? true : (values.off === true ? false : undefined);
    const groom = grooming(bots, { at: values.at, on });
    return { answer: { bots, groom }, lines: groomLines(groom, bots) };
  },

  usage(bots, values) {
    const usage = readUsage(bots, { bot: values.bot, session: values.session, since: values.since, until: values.until });
    return { answer: { bots, usage }, lines: usageLines(usage, bots) };
  },

  roster(bots, values) {
    const roster = readRoster(bots, { bot: values.bot });
    return { answer: { bots, roster }, lines: rosterLines(roster, bots) };
  },

  'skills fetch'(bots, values) {
    return fetched(bots, fetchSources(bots, { source: values.source }), 'Nothing to fetch');
  },

  'skills update'(bots, values) {
    return fetched(bots, fetchSources(bots, { source: values.source, moving: true }), 'Nothing to update');
  },

  'rules build'(bots, values) {
    const rules = buildRules(bots, { bot: values.bot });
    const trouble = rules.filter((entry) => entry.trouble !== undefined);
    return {
      answer: { bots, rules },
      lines: [
        ...rulesLines(rules, bots),
        trouble.length === 0
          ? `Rules are built. Your bots folder: ${bots}`
          // Not "not built": the file itself may be fine and the trouble be
          // the CLAUDE.md beside it, which is a bot whose rules still do not
          // reach both harnesses.
          : `${trouble.map((entry) => entry.bot).join(', ')}: the rules are not in place. Settle what the lines above say, then build again.`,
      ],
      // The build is the whole of this command, so a build it could not make is
      // what the command ends in. `up` answers for its tabs and is not held to
      // this: see bringUp.
      code: trouble.length === 0 ? 0 : 1,
    };
  },

  'message to'(bots, values) {
    // A lookup reads the book and nothing else, so it answers with Orca down:
    // knowing how to reach somebody is worth having when the app is not up.
    const answer = lookUp(bots, { to: values.to, from: values.from, tab: process.env[TAB_ENV] });
    const where = `${answer.to.bot}/${answer.to.session}`;
    return {
      answer,
      lines: [
        `${answer.transport.padEnd(9)}  ${where.padEnd(24)}  ${answer.address ?? '-'}`,
        ...toLines(answer, bots, where),
      ],
      code: answer.trouble === undefined ? 0 : 1,
    };
  },

  'message send'(bots, values) {
    refuseWhenOrcaIsDown();
    const answer = sendMessage(bots, {
      to: values.to,
      from: values.from,
      tab: process.env[TAB_ENV],
      subject: values.subject,
      text: values.text,
      textFile: values['text-file'],
      thread: values.thread,
    });
    const where = `${answer.to.bot}/${answer.to.session}`;

    if (!answer.sent) {
      return {
        answer,
        lines: [`${'not sent'.padEnd(9)}  ${where.padEnd(24)}  ${answer.subject}`, `             ${answer.trouble}`],
        code: 1,
      };
    }

    return {
      answer,
      lines: [
        `${'sent'.padEnd(9)}  ${where.padEnd(24)}  ${answer.subject}`,
        ...(answer.file === undefined
          ? []
          : [`             it was too long to travel as itself, so it went as a file:  ${answer.file}`]),
        ...[nudgeLine(answer, where)],
      ],
    };
  },

  'message check'(bots, values) {
    refuseWhenOrcaIsDown();
    const answer = checkMail(bots, {
      bot: values.bot,
      session: values.session,
      tab: process.env[TAB_ENV],
      peek: values.peek === true,
    });
    const where = `${answer.bot}/${answer.session}`;

    if (answer.trouble !== undefined) {
      return { answer, lines: [`${'trouble'.padEnd(9)}  ${where}`, `             ${answer.trouble}`], code: 1 };
    }

    return {
      answer,
      lines: [
        ...answer.messages.flatMap((message) => [
          `${'message'.padEnd(9)}  ${message.from}  ${message.at}`,
          `             ${message.subject}`,
          ...String(message.body ?? '').split('\n').map((line) => `             ${line}`),
        ]),
        answer.messages.length === 0
          ? `Nothing is waiting for ${where}.`
          // Said plainly, because a peek leaves the same mail there to be found
          // again and a read does not.
          : `${answer.messages.length} for ${where}${answer.read ? ', now read' : ', still unread: this was a peek'}.`,
      ],
    };
  },

  'session add'(bots, values) {
    const added = addSession(bots, values.bot, settingsOf(values));
    const found = workDirFound(values, added.bot, added.home, added.session.name);
    const answer = { bots, bot: added.bot, home: added.home, session: added.session, found };
    return {
      answer,
      lines: [
        `added      session ${added.session.name} to ${path.join('bots', added.bot, 'bot.yaml')}`,
        ...Object.entries(added.session)
          .filter(([key]) => key !== 'name')
          .map(([key, value]) => `           ${key}  ${oneLine(value)}`),
        ...foundLines(found),
        `Bring it up:  ${shellWord(ownCli())} up --bots ${shellWord(bots)} --bot ${added.bot}`,
      ],
    };
  },

  'session change'(bots, values) {
    if (values.harness !== undefined) {
      throw new Error(`session change does not change a session's harness: its conversations belong to the harness they ran on. To move it, retire it with obk retire and add one on ${values.harness} with obk session add.`);
    }
    const { name, ...settings } = settingsOf(values);
    const changed = changeSession(bots, values.bot, values.session, settings);
    const restart = `${shellWord(ownCli())} restart --bots ${shellWord(bots)} --bot ${changed.bot} --session ${values.session}`;
    const found = workDirFound(values, changed.bot, changed.home, values.session);
    return {
      answer: { bots, bot: changed.bot, home: changed.home, session: changed.session, restart, found },
      lines: [
        `changed    session ${values.session} in ${path.join('bots', changed.bot, 'bot.yaml')}`,
        ...Object.entries(changed.session)
          .filter(([key]) => key !== 'name')
          .map(([key, value]) => `           ${key}  ${oneLine(value)}`),
        ...foundLines(found),
        `A running session takes this when it next starts:  ${restart}`,
      ],
    };
  },
};

/**
 * What `obk message to` says under the road and the address: how to use it, or
 * what is in the way. A Claude pair the native road cannot carry says so, since
 * a caller told "use the mailbox" about two Claude sessions would otherwise
 * think the kit had forgotten its own rule.
 */
function toLines(answer, bots, where) {
  if (answer.trouble !== undefined) return [`             ${answer.trouble}`];
  if (answer.transport === 'native') {
    return [`             Write to ${answer.address} with your own harness's messaging. The kit does not carry that road.`];
  }
  return [
    ...(answer.unnamed === true
      ? [`             ${where} is a Claude session running under no name the kit gave it: it was started before the kit named sessions, and nothing renames a live harness. It gets one the next time it starts. Until then the mailbox is the road that reaches it.`]
      : []),
    `             Send it:  ${shellWord(ownCli())} message send --bots ${shellWord(bots)} --to ${shellWord(where)} --subject <text> --text <text>`,
  ];
}

/**
 * What became of the line that tells the receiver to look. The message is in
 * its mailbox whatever this says, so each of these is about the tab and not
 * about the message.
 */
function nudgeLine(answer, where) {
  if (answer.nudged) return '             its tab was told to look; it will read it when it is done with what it is doing.';
  if (answer.blocked !== undefined) {
    return `             its tab has something waiting to be answered (${answer.blocked}), so nothing was typed into it. Settle that, and the mail is there.`;
  }
  if (answer.nudgeTrouble !== undefined) {
    return `             it is queued, and its tab could not be told to look: ${answer.nudgeTrouble}`;
  }
  return `             ${where} is not up, so nothing was typed anywhere: the message waits in its mailbox.`;
}

/**
 * What there is to say about the work dir this command was given: one finding
 * when it leads out of the bot home, through `..` or a link or as a path
 * elsewhere, and nothing otherwise (#222). A bot's work and its clones belong
 * under its own `work/`. It is said, not refused: the user may ask for a folder
 * anywhere (PRD 6.3), and it is written as they gave it.
 */
function workDirFound(values, bot, home, session) {
  const workDir = workDirOf({ work_dir: values['work-dir'] }, home);
  if (workDir === undefined || leadsOutside(home, workDir) === undefined) return [];
  return [{
    kind: 'work-dir',
    where: workDir,
    says: `${workDir} is outside ${bot}'s folder, ${home}. A session's work and every clone it needs go under the bot's work/, as work/${session}, unless you asked for this place in plain words. It is written as given, and nothing was moved.`,
  }];
}

/** The settings a `session add` was given, as they go into bot.yaml. */
function settingsOf(values) {
  const settings = { name: values.name };
  for (const [flag, key] of SETTINGS) {
    if (values[flag] !== undefined) settings[key] = key === 'context' ? asNumberOrText(values[flag]) : values[flag];
  }
  if (values['extra-arg'] !== undefined) settings.extra_args = values['extra-arg'];
  return settings;
}

/** A context window written as a plain number stays one in the file. */
const asNumberOrText = (value) => (/^\d+$/.test(value) ? Number(value) : value);

const oneLine = (value) => (Array.isArray(value) ? value.join(' ') : String(value)).replace(/\s+/g, ' ').trim();

function refuseWhenOrcaIsDown() {
  const trouble = orcaTrouble();
  if (trouble !== undefined) throw new Error(trouble);
}

/** The same facts as `--json`, as lines, for a person reading along. */
/** The one line that says which conversation this tab was given, and from where. */
const howLine = (tab) => (tab.resumed === true
  ? '             it was told to resume the session the book holds, with its conversation.'
  : '             it was told to start a new session: the book holds none for this one yet.');

/**
 * What the harness still has in this bot's folder that no session claims. The
 * kit will not pick one — a bot's sessions and everything they start share that
 * folder — so it says what is there and how to settle it.
 */
const unclaimedLines = (tab, bots) => {
  const one = tab.unclaimed.length === 1;
  return [
    '             the kit cannot say which conversation this session had.',
    `             ${one ? 'This one ran' : 'These ran'} in this bot's folder and no session claims ${one ? 'it' : 'them'}:`,
    ...tab.unclaimed.map((id) => `               ${id}`),
    "             A bot's sessions share that folder, and so does anything they start",
    '             inside themselves, so the kit does not guess. To give one back, write it',
    `             into ${path.join(bots, 'bots', tab.bot, 'sessions.yaml')}`,
    `             under ${tab.name} as  session: <id>  and run obk up again.`,
  ];
};

/**
 * What `skills fetch` and `skills update` answer: a line per source saying what
 * became of it, at which ref, and which commit that turned out to be — the
 * version the user asked for beside the one they got.
 *
 * A source carrying scripts or hooks gets one line of its own, whatever is in
 * it. The kit does not scan it and does not stand in the way; the risk is the
 * user's to take and theirs to know about (PRD 6.7).
 */
function fetched(bots, sources, nothing) {
  const trouble = sources.filter((source) => source.trouble !== undefined);
  const lines = sources.flatMap((source) => (source.trouble !== undefined
    ? [`${'trouble'.padEnd(9)}  ${source.name}`, `             ${source.trouble}`]
    : [
      `${source.state.padEnd(9)}  ${source.name.padEnd(24)}  ${source.ref}  ${source.sha.slice(0, 7)}`,
      ...(source.runs ? [`             ${source.name} carries scripts or hooks. The kit neither looks at them nor stops them; they are the source's, and the risk is yours.`] : []),
    ]));

  return {
    answer: { bots, sources },
    lines: [
      ...lines,
      // eslint-disable-next-line no-nested-ternary
      sources.length === 0 ? `${nothing}: skills.yaml lists no sources. Your bots folder: ${bots}`
        : trouble.length === 0 ? `Your sources are where they should be. Your bots folder: ${bots}`
          : `${trouble.map((source) => source.name).join(', ')}: not fetched. Settle what the lines above say, then try again.`,
    ],
    code: trouble.length === 0 ? 0 : 1,
  };
}

/**
 * What each bot's sessions have used, as lines: a block per session, a line per
 * conversation, and the bot's unclaimed ones under it. Tokens and no money, the
 * same as the answer, because the price is looked up by whoever is reading.
 */
function usageLines(usage, bots) {
  const lines = [];

  for (const entry of usage) {
    lines.push(`${'bot'.padEnd(9)}  ${entry.bot}`);
    for (const session of entry.sessions) {
      lines.push(`${'session'.padEnd(9)}  ${session.name}`);
      lines.push(...session.conversations.map(conversationLine));
      if (session.conversations.length === 0) lines.push('             nothing on record');
    }
    if (entry.unclaimed.length > 0) {
      lines.push(`${'unclaimed'.padEnd(9)}  ${entry.bot}: no session of this bot claims these`);
      lines.push(...entry.unclaimed.map(conversationLine));
    }
  }

  lines.push(usage.length === 0
    ? `No bots yet. Your bots folder: ${bots}`
    : `${usage.length} bot${usage.length === 1 ? '' : 's'}. What a token costs is yours to look up. Your bots folder: ${bots}`);
  return lines;
}

/** One conversation: what it is, what it ran as, and what it used. */
function conversationLine(one) {
  const ran = [...one.models, ...one.efforts].join(' ');
  const used = Object.entries(one.tokens)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind} ${count}`)
    .join('  ');
  return `             ${one.id}  ${one.calls} call${one.calls === 1 ? '' : 's'}`
    + `${ran === '' ? '' : `  ${ran}`}`
    + `${used === '' ? '' : `  ${used}`}`
    + `${one.compactions > 0 ? `  compacted ${one.compactions}` : ''}`;
}

/**
 * What there is to say about the daily grooming: whether it exists, when it
 * runs, and whether it is on. A grooming that is off is not a fault, so this
 * says what is there and what the next step would be rather than warning.
 */
function groomLines(groom, bots) {
  if (!groom.exists) {
    return [
      `${'groom'.padEnd(9)}  there is no daily grooming yet`,
      `Make one:  ${shellWord(ownCli())} groom --bots ${shellWord(bots)} --at 04:00`,
    ];
  }

  return [
    `${'groom'.padEnd(9)}  daily at ${groom.at}  ${groom.enabled ? 'on' : 'off'}`,
    groom.enabled
      ? `It runs every day at ${groom.at} and spends tokens each time. Turn it off with:  ${shellWord(ownCli())} groom --bots ${shellWord(bots)} --off`
      : `It is not running yet. Try it by hand, read what it gives you, then:  ${shellWord(ownCli())} groom --bots ${shellWord(bots)} --on`,
  ];
}

/** The settings a session carries, in the order a session is written down. */
const SHOWN = SESSION_FIELDS.filter((field) => field !== 'name' && field !== 'harness');

/**
 * The fleet as lines: a block per bot, then a block per session under it. The
 * facts and nothing else, in the order the answer carries them, so that what a
 * person reads here and what a skill reads from `--json` are the same thing.
 *
 * The charter is printed whole. It is the one part of a bot that says what it
 * is for, and a report that shortened it would be making the judgement this
 * command does not make.
 */
function rosterLines(roster, bots) {
  const lines = [];

  for (const entry of roster) {
    lines.push(`${'bot'.padEnd(9)}  ${entry.bot}${entry.harness === undefined ? '' : `  ${entry.harness}`}${entry.paused === true ? '  paused' : ''}`);
    if (entry.charter !== undefined) {
      lines.push(...String(entry.charter).trimEnd().split('\n').map((line) => `             ${line}`.trimEnd()));
    }
    for (const [what, list] of [['rules', entry.rules], ['skills', entry.skills]]) {
      if (list.length > 0) lines.push(`             ${what.padEnd(6)}  ${list.join('  ')}`);
    }
    if (entry.orca.project !== undefined) {
      lines.push(`             Orca project ${entry.orca.project}${entry.orca.setup === undefined ? '' : `  setup ${entry.orca.setup}`}`);
    }
    for (const session of entry.sessions) lines.push(...sessionLines(session));
  }

  lines.push(roster.length === 0
    ? `No bots yet. Make one:  ${shellWord(ownCli())} bot create --bots ${shellWord(bots)} --name <name> --harness claude|codex`
    : `${roster.length} bot${roster.length === 1 ? '' : 's'}. Your bots folder: ${bots}`);
  return lines;
}

/**
 * One session: what it is set to, then what the kit knows about it as a running
 * thing. A setting it does not carry is left out rather than filled in, because
 * left out is what it means — the harness's own default, whatever that is today.
 */
function sessionLines(session) {
  const set = SHOWN
    .filter((field) => session[field] !== undefined)
    .map((field) => `${field} ${oneLine(session[field])}`);
  const book = session.book;

  return [
    `${'session'.padEnd(9)}  ${session.name}${session.harness === undefined ? '' : `  ${session.harness}`}${set.length === 0 ? '' : `  ${set.join('  ')}`}${session.paused === true ? '  paused' : ''}`,
    ...(book.tab === undefined
      ? []
      : [`             tab ${book.tab}${book.launched === undefined ? '' : `  launched ${book.launched}`}`]),
    ...(book.session === undefined ? [] : [`             conversation ${book.session}`]),
    ...(book.history ?? [])
      .filter((was) => was?.session !== undefined)
      .map((was) => `             was ${was.session}${was.ended === undefined ? '' : `  ${was.ended}`}`),
    ...(book.unclaimed ?? []).map((id) => `             unclaimed ${id}`),
  ];
}

/**
 * What became of each bot's `AGENTS.md`, in the same column as the rest of the
 * report: what the build did, the file it did it to, and what it carries. A
 * build that would not go through says what is in the way instead, in the
 * words of whoever has to settle it.
 */
function rulesLines(rules, bots) {
  return rules.flatMap((entry) => {
    const what = entry.units === undefined
      ? ''
      : `  ${entry.units.length} unit${entry.units.length === 1 ? '' : 's'}`;
    return [
      `${entry.state.padEnd(9)}  ${path.relative(bots, entry.file)}${what}`,
      // Named on the run that made it: it is a file the command wrote.
      ...(entry.linked === undefined
        ? []
        : [`${'linked'.padEnd(9)}  ${path.relative(bots, entry.linked)} -> AGENTS.md`]),
      ...(entry.trouble === undefined ? [] : [`             ${entry.trouble}`]),
      // Codex reads no more than this of an instructions file, and says nothing
      // when it stops reading (tech notes, section 3).
      ...(entry.bytes > CODEX_CAP
        ? [`             it is over the ${CODEX_CAP / 1024} KiB Codex reads, so a Codex session will not see all of it.`]
        : []),
    ];
  });
}

/**
 * What each bot has in its skills directories: one line naming the bot, then
 * one per skill — what became of it, its name, and which shelf it came from.
 * A skill the user put there themselves is named too, and said to be theirs.
 */
function skillsLines(skills) {
  return skills.flatMap((entry) => [
    entry.bot,
    ...(entry.trouble === undefined ? [] : [`  ${'trouble'.padEnd(9)}  ${entry.trouble}`]),
    ...entry.skills.map((skill) => `  ${(skill.managed ? 'linked' : 'yours').padEnd(9)}  ${skill.name.padEnd(24)}  ${skill.from ?? 'no list names it; the kit leaves it alone'}`),
    ...(entry.removed ?? []).map((name) => `  ${'removed'.padEnd(9)}  ${name.padEnd(24)}  no list names it now`),
  ]);
}

/**
 * What a check found, two lines each: what kind of trouble it is and the one
 * thing to go and look at, then the sentence about it. The same shape wherever
 * a command reports one, so a reader who has seen one has seen them all.
 */
const foundLines = (found) =>
  found.flatMap((one) => [`${one.kind.padEnd(9)}  ${one.where}`, `             ${one.says}`]);

function tabLines({ bots, created, completed, rules, skills, tabs, paused = [], found = [] }, summary) {
  const lines = [
    ...created.map((entry) => `created    ${entry}`),
    ...completed.map((entry) => `completed  ${entry}`),
    ...rulesLines(rules, bots),
    ...skillsLines(skills),
  ];

  for (const tab of tabs) {
    lines.push(`${tab.created ? 'opened' : 'found '}     ${tab.title}  tab ${tab.tabId}  terminal ${tab.terminal}`);
    lines.push(...harnessLines(tab, bots));
  }
  for (const one of paused) {
    const what = one.session === undefined ? one.bot : `${one.bot} ${one.session}`;
    const back = one.session === undefined ? '' : ` --session ${one.session}`;
    lines.push(`${'paused'.padEnd(9)}  ${what}  left closed. Bring it back:  ${shellWord(ownCli())} unpause --bots ${shellWord(bots)} --bot ${one.bot}${back}`);
  }

  // Last before the summary, because what a check found is about the setup the
  // run has just left behind rather than about any one thing it did.
  lines.push(...foundLines(found), summary);
  return lines;
}

/**
 * What became of the harness in a tab this run opened. Nothing is typed into a
 * tab that was already there, and nothing into the plain tab beside the
 * sessions, so those have nothing to say.
 *
 * The caller decides what to do next from these lines, so they say both what
 * was typed and what was seen afterwards, and never one in place of the other.
 */
function harnessLines(tab, bots) {
  if (!tab.created || tab.name === null) return [];

  // What the line that was typed in asked for, and where the kit got it: the
  // session the book holds, one the harness itself still had on record, or a new
  // one — and if a new one, whether anything was known about an older one.
  const how = [howLine(tab)];

  if (!tab.harnessStarted) {
    return [
      ...how,
      '             the harness was typed in, and no session came up in the tab.',
      `             Look at it:  ${lookAt(tab.terminal)}`,
      ...ANSWER_IT,
    ];
  }

  const lines = tab.blockedReason === undefined
    ? [...how, '             the harness was typed in and came up.']
    : [
      ...how,
      `             the harness was typed in and came up, waiting on: ${tab.blockedReason}`,
      `             Look at it:  ${lookAt(tab.terminal)}`,
      ...ANSWER_IT,
    ];

  if (tab.promptSent === true) lines.push('             the start prompt was typed in.');
  if (tab.promptSent === false) {
    lines.push('             the start prompt was not typed in: the tab was not ready for it.');
  }
  if (tab.unclaimed !== undefined) lines.push(...unclaimedLines(tab, bots));
  return lines;
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`obk: ${error.message}\n`);
  process.exitCode = 1;
}
