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

import { addSession, allowedNow, allowRules, botDir, changeBot, changeSession, createBot, disallowRules, leadsOutside, readBot, SESSION_FIELDS } from './bot.js';
import { addCommand, groomCommand, grooming, upCommand } from './groom.js';
import { checkHealth, orcaSettingFindings } from './health.js';
import { initBots } from './init.js';
import { nameSession } from './name.js';
import { APPROVALS, HARNESSES, ownCli, shellWord, workDirOf } from './launch.js';
import { checkMail, decideLeftNudges, lookUp, noMailboxYet, sendMessage, sessionInTab, stillUnread, WATCH_MS } from './message.js';
import { orcaCli, orcaTrouble, RELOAD_LINE, TERMINAL_ENV } from './orca.js';
import { allowCommand, allowIn, beyondDefaults, refuseBroad, refuseNoCodexForm, runsOnClaude, runsOnCodex, takeBack, writePermissions } from './permissions.js';
import { pauseSessions, unpauseSessions } from './pause.js';
import { recordSession, SHELL_ENV, TAB_ENV } from './record.js';
import { restartSessions } from './restart.js';
import { clearSession, compactSession } from './clear.js';
import { retireBot, retireSession, unreadWords } from './retire.js';
import { sentWarning } from './sent.js';
import { readRoster } from './roster.js';
import { buildAgents, buildRules, CODEX_CAP } from './rules.js';
import { addSkill, buildSkills, linkSkills, removeSkill } from './skills.js';
import { addSource, fetchSources } from './sources.js';
import { answerSession, answerTemp, listRoles, makeTemp, optionsLine, retireTemp, trustHooks, trustSessionHooks } from './temp.js';
import { readUsage } from './usage.js';
import { BOT_FATHER, bringUp, ownMailbox } from './up.js';

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
  obk bot change --bots <path> --bot <bot> [--charter <text>]
                 [--allow <rule> ... | --disallow <rule> ...]
                            Give a bot a new charter and rebuild its AGENTS.md.
                            A running session reads it when it next starts.
                            --allow records a permission rule the user said
                            yes to, once per rule, and writes it into the bot's
                            Claude settings. A broad rule, such as Bash(gh:*),
                            is refused and nothing is written.
                            --disallow takes back a rule the bot was allowed,
                            once the user has said yes to that, from bot.yaml
                            and the bot's settings. A rule the user added by
                            hand is not the kit's, and is refused.
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
                            bot, keeping its conversations in the book, and
                            first do the same for the temporary sessions it
                            made, and theirs. It stops what the session left
                            running in its work dir, and names each process.
                            Or end a bot: close its tabs,
                            remove its Orca project and move its folder to
                            retired/. It will not retire a bot whose Orca
                            project holds a tab your book does not name, and
                            moves the folder only once Orca no longer lists
                            the project.
  obk temp make --bots <path> --name <session> [--role <role>[:<option>]]
                (--prompt <text> | --prompt-file <path>) [--harness claude|codex]
                [--model <m>] [--effort <e>] [--context <c>]
                [--approval ${APPROVALS.join('|')}] [--extra-arg=<arg>]...
                            Run in a session's own tab: make a temporary
                            session of that session's bot for a piece of work,
                            and bring it up. A temporary session makes one at
                            a time, and one it made makes none. It takes your
                            harness, model, effort, context and approval unless
                            you say otherwise; on another harness than yours
                            it takes only your approval. It works in
                            work/<session>, and has the task as its start
                            prompt. The book records it as temporary, made by
                            you.
                            --role takes the harness, model, effort and context
                            of an option of a role in the bot's temp_roles, the
                            role's first option when none is named, and the
                            role's prompt file when no task is given; a flag
                            still wins, and what the option leaves out is
                            taken as above. The session is named
                            <role>-<session>. A role's cap, if it has one,
                            counts its open sessions. The answer says where
                            each setting came from.
  obk temp roles --bots <path>
                            Run in a session's own tab: list the roles of your
                            bot's temp_roles, each option with what it is for,
                            and each role's cap and open sessions.
  obk temp retire --bots <path> --name <session>
                            Run in the maker's own tab: retire a temporary
                            session it made, as obk retire does. It refuses a
                            long-lived session, or one another session made.
                            Like obk retire, it first retires the temporary
                            sessions that session made.
  obk temp trust-hooks --bots <path> --name <session>
                            Run in the maker's own tab: answer the hooks review
                            of a Codex temporary session it made with "Trust
                            all and continue", and check the review went. It
                            refuses anything else on that screen, and types
                            nothing then. It refuses, as obk session
                            trust-hooks does, hooks that are not the kit's.
  obk temp answer --bots <path> --name <session>
                            Run in the maker's own tab: answer Claude Code's
                            "Teach auto mode" screen on a temporary session it
                            made with Not now, in a shape the kit knows, and
                            check the screen went. It refuses any other
                            screen, and types nothing then.
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
                            and shown as yours. A bot whose links changed has
                            its running sessions told: Claude Code gets
                            /reload-skills typed in, and Codex takes the
                            change at its next turn.
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
  obk session clear --bots <path> --bot <bot> --session <name>
                            Start the session on a new conversation: /clear on
                            Claude Code, /new on Codex. It waits up to 30 s for
                            the session to be idle, types nothing into a busy
                            one or one with a question on its screen, and
                            answers once the book holds the new conversation.
                            The kit's hook gives it its start prompt again.
  obk session compact --bots <path> --bot <bot> --session <name>
                            Compact the session's conversation with /compact,
                            as safely as session clear, and answer once the
                            harness's record shows it, or after 5 minutes that
                            it is not confirmed yet.
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
  obk groom --bots <path> [--on [--at <HH:MM>] [--run-on codex [--model <m>] [--effort <e>] [--extra-arg=<arg>]...]
                | --at <HH:MM> | --off | --now | --compact]
                            Say what the daily grooming is: Bot Father's session
                            grooming, and the job scheduled in it on Claude
                            Code's own scheduler. Add that session like any
                            other, with the model and effort each run is to use.
                            --now asks it to run the grooming once. --on --at
                            asks it to schedule it daily, and each run renews
                            it; it starts off, because it spends tokens every
                            day, so run it by hand once and read it first. --at
                            moves it, --off unschedules it, and --compact
                            compacts its conversation between runs. It fires
                            only while its tab is up in Orca. --run-on codex
                            makes each run a temporary Codex session of the
                            grooming session's, launched with --model, --effort
                            and --extra-arg, which reports back by the kit's
                            mail and is retired.
  obk usage --bots <path> [--bot <bot>] [--session <name>] [--since <time>] [--until <time>]
                            Say what your sessions have used: the conversations
                            each one had, their calls and tokens (their
                            subagents' and Codex's auto-reviews included, and
                            how many were whose), the models and efforts they
                            ran at, and how often they were compacted. --since
                            counts the calls made from that moment on, and
                            --until the calls made before that one: a daily run
                            asks from the last run's end up to its own, and the
                            next starts where it stopped, so no call is counted
                            twice. It counts tokens and never money: what a
                            token costs is looked up live by whoever is asking.
  obk session trust-hooks --bots <path> --bot <bot> --session <name>
                            Run by Bot Father or the user: answer the hooks
                            review of a long-lived Codex session with "Trust
                            all and continue", as obk temp trust-hooks does,
                            and check the review went. It refuses when the
                            bot's .codex/hooks.json holds a hook that is not
                            the kit's, or when the review counts other hooks
                            than the kit's own that Codex does not trust yet.
  obk session answer --bots <path> --bot <bot> --session <name>
                            Run by Bot Father or the user: answer Claude Code's
                            "Teach auto mode" screen on a long-lived session
                            with Not now, as obk temp answer does, and check
                            the screen went.
  obk session record --bots <path> --bot <bot>
                            For the kit's own hook, not for typing: it reads
                            what the harness says about a session starting on
                            standard input and writes it into the book.
  obk session sent --bots <path> --bot <bot>
                            For the kit's own hook, not for typing: after a
                            Claude session's native message, it warns the
                            session when the address was none of this bots
                            folder's own. It never stops a message.
  obk session nudge --bots <path> --bot <bot>
                            For the kit's own hook, not for typing: after a
                            Codex session's shell command, it decides the mail
                            nudges a send there left because it could not
                            tell from inside Codex's sandbox, and types each
                            one or says why not.
  obk session mail --bots <path> --bot <bot>
                            For the kit's own hook, not for typing: at the end
                            of a Claude session's turn, it tells the session
                            once about each fleet mail the kit sent it that is
                            still unread. It types nothing into the tab.
  obk session name --bots <path> --bot <bot>
                            For the kit's own hook, not for typing: after a
                            Codex session's turn, it names the session's thread
                            <bot>.<session> with Codex's /rename, once the
                            session is idle, so its tab says which it is.
  obk session mailbox --bots <path> --bot <bot> --session <name>
                            For the kit's own launch line, not for typing: run
                            in the session's own tab, it gives the session its
                            mailbox, or binds the one it has, to that tab.
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
  'session clear': ['bots', 'bot', 'session'],
  'session compact': ['bots', 'bot', 'session'],
  'message to': ['bots', 'to'],
  'message send': ['bots', 'to', 'subject'],
  'message check': ['bots'],
  'session record': ['bots', 'bot'],
  'session sent': ['bots', 'bot'],
  'session nudge': ['bots', 'bot'],
  'session mail': ['bots', 'bot'],
  'session name': ['bots', 'bot'],
  'session mailbox': ['bots', 'bot', 'session'],
  'session trust-hooks': ['bots', 'bot', 'session'],
  'session answer': ['bots', 'bot', 'session'],
  'temp make': ['bots', 'name'],
  'temp roles': ['bots'],
  'temp retire': ['bots', 'name'],
  'temp trust-hooks': ['bots', 'name'],
  'temp answer': ['bots', 'name'],
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
  role: '--role <role>[:<option>]: which role of the bot\'s temp_roles',
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
      now: { type: 'boolean' },
      compact: { type: 'boolean' },
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
      allow: { type: 'string', multiple: true },
      disallow: { type: 'string', multiple: true },
      ...Object.fromEntries(SETTINGS.map(([flag]) => [flag, { type: 'string' }])),
      'extra-arg': { type: 'string', multiple: true },
      'run-on': { type: 'string' },
      role: { type: 'string' },
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

  // `bot`, `rules`, `skills`, `session`, `source`, `message` and `temp` are
  // commands of two words; the rest are one.
  const words = ['bot', 'rules', 'skills', 'session', 'source', 'message', 'temp'].includes(positionals[0]) ? 2 : 1;
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

  // The send hook is quiet whatever it is given, a bots folder that is not
  // there included, so it goes before anything that can complain (ADR 0032).
  if (command === SENT) return sent(path.resolve(values.bots));
  if (command === NUDGE) return nudgeLeft();
  if (command === MAIL) return mailHook(path.resolve(values.bots), values.bot);
  if (command === NAME) return nameThread(path.resolve(values.bots), values.bot);

  // One fleet, one identity, whatever spelling of its path was given (#164).
  const bots = command === 'init' ? path.resolve(values.bots) : sameFleet(path.resolve(values.bots));
  if (command === RECORD) return record(bots, values.bot);

  const { answer, lines, code = 0 } = await commands[command](bots, values);

  process.stdout.write(values.json ? `${JSON.stringify(answer, null, 2)}\n` : `${lines.join('\n')}\n`);
  // A session whose tab was opened and not launched is a command that stopped
  // short, whichever command opened it (#498).
  return answer?.tabs?.some((tab) => tab.launched === false) ? 1 : code;
}

/**
 * The bots folder as the file system knows it. A folder reached through a
 * symlink is the same fleet: the harnesses file their transcripts under the real
 * path, and what the kit keeps
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

/** The commands a harness runs rather than a person: the kit's hooks. */
const RECORD = 'session record';
const SENT = 'session sent';
const NUDGE = 'session nudge';
const MAIL = 'session mail';
const NAME = 'session name';

/**
 * What the kit's send hook says after a native message: a warning the session
 * reads, as Claude Code's `additionalContext`, or nothing. Never a decision,
 * and never anything but exit 0 (ADR 0032).
 */
function sent(bots) {
  try {
    const warning = sentWarning(bots, JSON.parse(readFileSync(0, 'utf8')));
    if (warning !== undefined) {
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: warning } })}\n`);
    }
  } catch {
    // Nothing: a hook does not disturb the session it runs in.
  }
  return 0;
}

/**
 * What the kit's Codex hook does after a shell command: decide the nudges a
 * send in this tab left for it, outside Codex's sandbox, and say to the session
 * what became of each, as Codex's `additionalContext` (#350, ADR 0034). Silent
 * when nothing was left, never a decision, and never anything but exit 0.
 */
async function nudgeLeft() {
  try {
    const said = JSON.parse(readFileSync(0, 'utf8'));
    if (said?.hook_event_name !== 'PostToolUse') return 0;
    const decided = await decideLeftNudges(process.env[TAB_ENV]);
    if (decided.length > 0) {
      const words = decided.map((one) => `Your mail "${one.subject}" to ${one.to}: ${one.nudged ? "the kit's hook nudged its tab, from outside Codex's sandbox:" : "the kit's hook looked at its tab from outside Codex's sandbox, and"} ${nudgeLine(one, one.to).trim()}`);
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: words.join('\n') } })}\n`);
    }
  } catch {
    // Nothing: a hook does not disturb the session it runs in.
  }
  return 0;
}

/**
 * What the kit's Claude Code Stop hook does at a turn end (#509, ADR 0035): tell
 * the session once about fleet mail still unread, as the Stop event's
 * additional context, which the session goes on with. Not a block: Claude Code
 * 2.1.296 draws a block's reason in red as "Stop hook error", and its additional
 * context as "Stop hook feedback". Nothing typed into the tab; never anything
 * but exit 0; silent whenever it cannot be sure.
 */
function mailHook(bots, bot) {
  try {
    const reason = stillUnread(sameFleet(bots), bot, JSON.parse(readFileSync(0, 'utf8')), process.env[TAB_ENV], process.env[TERMINAL_ENV]);
    if (reason !== undefined) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: reason } })}\n`);
  } catch {
    // Nothing: a hook does not disturb the session it runs in.
  }
  return 0;
}

/**
 * What the kit's Codex Stop hook does at a turn end: name the session's thread
 * after its bot and session, once it is idle (#480). Silent, never a decision,
 * and never anything but exit 0: what it could not type now waits for the next
 * turn end.
 */
async function nameThread(bots, bot) {
  try {
    await nameSession(bots, bot, JSON.parse(readFileSync(0, 'utf8')), process.env[TAB_ENV]);
  } catch {
    // Nothing: a hook does not disturb the session it runs in.
  }
  return 0;
}

/**
 * What the kit's hook does with what the harness told it, and what it answers.
 *
 * A hook runs inside the user's own session, so this one stays out of the way:
 * it writes on standard output only what the harness is to read as JSON, and
 * whatever goes wrong, it goes wrong quietly. A book left stale is a thing the
 * health check finds later; a session disturbed is the user's work (ADR 0022).
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
    const { tabs, rules, skills, permissions, paused, projects } = await bringUp(sameFleet(seeded.bots), { bot: BOT_FATHER });
    // Setup is the other place the PRD asks for Orca's own launch arguments to
    // be looked at (6.5), and the one where the user is still standing in front
    // of the fleet they are making. Only that one check: a folder init has just
    // made has nothing else to say about itself.
    const answer = { bots: seeded.bots, created: seeded.created, completed: seeded.completed, rules, skills, permissions, tabs, paused, projects, found: orcaSettingFindings() };
    return { answer, lines: tabLines(answer, `Bot Father is up in Orca. Your bots folder: ${seeded.bots}`) };
  },

  async up(bots, values) {
    refuseWhenOrcaIsDown();
    const { tabs, rules, skills, permissions, paused, projects } = await bringUp(bots, { bot: values.bot, session: values.session });
    const answer = { bots, created: [], completed: [], rules, skills, permissions, tabs, paused, projects };
    const up = [...new Set(tabs.map((tab) => tab.bot))];
    const summary = up.length === 0
      ? `Nothing was brought up in Orca. Your bots folder: ${bots}`
      : `Up in Orca: ${up.join(', ')}. Your bots folder: ${bots}`;
    return { answer, lines: tabLines(answer, summary) };
  },

  health(bots, values) {
    refuseWhenOrcaIsDown();
    const { found, sessions } = checkHealth(bots, { bot: values.bot });
    return {
      answer: { bots, found, sessions },
      lines: [
        ...foundLines(found),
        ...sessions.map(settingsLine),
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
    const { closed, tabs, rules, skills, permissions, paused, projects } = await restartSessions(bots, { bot: values.bot, session: values.session });
    const answer = { bots, created: [], completed: [], rules, skills, permissions, tabs, paused, projects, closed };
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
    if (values.session !== undefined) {
      const retired = await retireSession(bots, { bot: values.bot, session: values.session });
      return {
        answer: { bots, ...retired },
        lines: [
          ...withLines(retired.retiredWith, retired.session),
          ...closedLines(retired.closed),
          `retired    ${retired.bot} ${retired.session}: off ${path.join('bots', retired.bot, 'bot.yaml')}, and its conversations kept in the book under retired`,
          ...unreadLines(retired.unread),
          ...processLines(retired.processes),
          ...leftLines(retired.promptsLeft),
        ],
      };
    }

    const retired = await retireBot(bots, { bot: values.bot });
    if (retired.trouble !== undefined) {
      return {
        answer: { bots, ...retired },
        lines: [
          ...closedLines(retired.closed),
          ...processLines(retired.processes),
          `${'trouble'.padEnd(9)}  Orca project ${retired.project}`,
          `             ${retired.trouble}`,
          `Retire it again:  ${shellWord(ownCli())} retire --bots ${shellWord(bots)} --bot ${retired.bot}`,
        ],
        code: 1,
      };
    }
    return {
      answer: { bots, ...retired },
      lines: [
        ...closedLines(retired.closed),
        // Orca's window keeps a removed project's row until it is rebuilt
        // (#343): the user reloads it by hand only when the kit could not.
        ...(retired.project === undefined ? [] : [
          `removed    Orca project ${retired.project}`,
          retired.windowReloaded ? "reloaded   Orca's window, so its sidebar no longer shows the project" : RELOAD_LINE,
        ]),
        `retired    ${retired.bot}: moved to ${path.relative(bots, retired.moved)}, with its book, charter and memory`,
        ...(retired.unread ?? []).flatMap((one) => unreadLines(one, `${retired.bot}/${one.session}`)),
        ...processLines(retired.processes),
        ...leftLines(retired.promptsLeft),
      ],
    };
  },

  async 'temp make'(bots, values) {
    const tab = callerTab(bots, true);
    refuseWhenOrcaIsDown();
    const given = { name: values.name };
    for (const [flag, key] of [['harness', 'harness'], ['model', 'model'], ['effort', 'effort'], ['approval', 'approval'], ['prompt', 'prompt'], ['prompt-file', 'prompt_file'], ['role', 'role']]) {
      if (values[flag] !== undefined) given[key] = values[flag];
    }
    if (values.context !== undefined) given.context = asNumberOrText(values.context);
    if (values['extra-arg'] !== undefined) given.extra_args = values['extra-arg'];
    const made = await makeTemp(bots, { tab, ...given });
    const { tabs, rules, skills, permissions, paused, projects } = made.up;
    const answer = {
      bots, bot: made.bot, session: made.session, maker: made.maker, ...(made.role === undefined ? {} : { role: made.role }), settings: made.settings, chosen: made.chosen,
      created: [], completed: [], rules, skills, permissions, tabs, paused, projects,
    };
    const retire = `${shellWord(ownCli())} temp retire --bots ${shellWord(bots)} --name ${made.session}`;
    return {
      answer,
      lines: [
        ...(made.role === undefined ? [] : [`role       ${made.role.name}:${made.role.option}${made.role.for === undefined ? '' : `, for ${made.role.for}`}. Its options: ${optionsLine(made.role.options)}`]),
        ...Object.entries(made.chosen).map(([setting, one]) => `${setting.padEnd(9)}  ${one.value === undefined ? `the ${one.from}` : `${one.value}, from ${one.from === 'flag' ? `--${setting}` : `the ${one.from}`}`}`),
        ...tabLines(answer, tabs.some((one) => one.launched === false)
          ? `${made.bot}/${made.session}, a temporary session of ${made.maker}'s, is in bot.yaml and the book, and was not launched. Restart it once its tab is ready, or retire it:  ${retire}`
          : `Made ${made.bot}/${made.session}, a temporary session of ${made.maker}'s, working in work/${made.session}. Retire it when its work is done:  ${retire}`),
      ],
    };
  },

  'temp roles'(bots) {
    const tab = callerTab(bots, true);
    const listed = listRoles(bots, { tab });
    const lines = listed.roles.length === 0
      ? [`${listed.bot} has no roles for temporary sessions: its bot.yaml has no temp_roles.`]
      : listed.roles.flatMap((role) => [
        `role       ${role.name}${role.cap === undefined ? '' : `, cap ${role.cap}`}, open: ${role.open.length === 0 ? 'none' : role.open.join(', ')}${role.prompt_file === undefined ? '' : `, prompt file ${role.prompt_file}`}`,
        ...role.options.map((option) => `  ${option.default ? 'default' : 'option '}  ${role.name}:${option.name}${option.for === undefined ? '' : `, for ${option.for}`}: ${['harness', 'model', 'effort', 'context'].filter((key) => option[key] !== undefined).map((key) => `${key} ${option[key]}`).join(', ') || 'all as you have them'}`),
        ...(role.trouble ?? []).map((says) => `  trouble  ${says}`),
      ]);
    return { answer: { bots, ...listed }, lines };
  },

  async 'temp retire'(bots, values) {
    const tab = callerTab(bots, true);
    refuseWhenOrcaIsDown();
    const retired = await retireTemp(bots, { tab, name: values.name });
    return {
      answer: { bots, ...retired },
      lines: [
        ...withLines(retired.retiredWith, retired.session),
        ...closedLines(retired.closed),
        `retired    ${retired.bot} ${retired.session}, a temporary session of ${retired.maker}'s: off ${path.join('bots', retired.bot, 'bot.yaml')}, and its conversations kept in the book under retired`,
        ...unreadLines(retired.unread),
        ...processLines(retired.processes),
        ...leftLines(retired.promptsLeft),
      ],
    };
  },

  async 'temp trust-hooks'(bots, values) {
    const tab = callerTab(bots, true);
    refuseWhenOrcaIsDown();
    const trusted = await trustHooks(bots, { tab, name: values.name });
    return {
      answer: { bots, ...trusted },
      lines: [`trusted    ${trusted.bot} ${trusted.session}'s hooks, a temporary session of ${trusted.maker}'s: chose "Trust all and continue" on its hooks review, and the review has gone`],
    };
  },

  async 'temp answer'(bots, values) {
    const tab = callerTab(bots, true);
    refuseWhenOrcaIsDown();
    const answered = await answerTemp(bots, { tab, name: values.name });
    return {
      answer: { bots, ...answered },
      lines: [
        `answered   ${answered.bot} ${answered.session}, a temporary session of ${answered.maker}'s: sent ${answered.sent} to its "Teach auto mode about your environment?" screen, and the screen has gone`,
        `rule       a maker's bot runs this under one permission rule, which the user approves:  Bash(${shellWord(ownCli())} temp answer:*)`,
      ],
    };
  },

  async 'session trust-hooks'(bots, values) {
    const tab = callerTab(bots, true);
    refuseWhenOrcaIsDown();
    const trusted = await trustSessionHooks(bots, { tab, bot: values.bot, session: values.session });
    return {
      answer: { bots, ...trusted },
      lines: [`trusted    ${trusted.bot} ${trusted.session}'s hooks: chose "Trust all and continue" on its hooks review, and the review has gone`],
    };
  },

  async 'session answer'(bots, values) {
    const tab = callerTab(bots, true);
    refuseWhenOrcaIsDown();
    const answered = await answerSession(bots, { tab, bot: values.bot, session: values.session });
    return {
      answer: { bots, ...answered },
      lines: [`answered   ${answered.bot} ${answered.session}: sent ${answered.sent} to its "Teach auto mode about your environment?" screen, and the screen has gone`],
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
    // Nothing is allowed yet, so this writes nothing: it says which of the
    // kit's rules wait for the user's yes (#344).
    const permissions = writePermissions(bots, made.home, readBot(made.home));
    const answer = { bots, bot: made.bot, home: made.home, created: made.created, rules, skills, permissions };
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
        ...permissionsLines(permissions, bots),
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
    if (values.charter === undefined && values.allow === undefined && values.disallow === undefined) {
      throw new Error('bot change needs --charter <text>, --allow <rule> or --disallow <rule>: what to change.');
    }
    if (values.allow !== undefined && values.disallow !== undefined) {
      throw new Error('bot change takes --allow or --disallow, not both at once, so nothing was changed. Run one, then the other.');
    }
    // Refused before anything is written, so a bad rule, or a bad list already
    // there, leaves the charter as it was too.
    let allowInto;
    if (values.allow !== undefined) {
      const { home } = allowedNow(bots, values.bot, values.allow);
      refuseBroad(home, values.allow);
      const bot = readBot(home, values.bot);
      refuseNoCodexForm(bot, values.allow);
      const { allow } = allowRules(bots, values.bot, values.allow, { write: false });
      allowInto = allowIn(bots, home, { ...bot, allow });
    }
    let takeBackFrom;
    if (values.disallow !== undefined) {
      const { home } = allowedNow(bots, values.bot, values.disallow, '--disallow');
      takeBackFrom = takeBack(bots, home, readBot(home, values.bot), values.disallow);
      disallowRules(bots, values.bot, values.disallow, { write: false });
    }

    const answer = { bots, bot: values.bot, home: botDir(bots, values.bot) };
    const lines = [];
    let trouble = false;
    if (values.charter !== undefined) {
      const changed = changeBot(bots, values.bot, { charter: values.charter });
      // Rebuilt at once, as bot create builds it, so the charter a session reads
      // is the one the bot now has.
      const rules = [buildAgents(bots, changed.home, readBot(changed.home))];
      trouble = rules[0].trouble !== undefined;
      Object.assign(answer, { charter: changed.charter, rules });
      lines.push(
        `changed    the charter in ${path.join('bots', changed.bot, 'bot.yaml')}`,
        ...rulesLines(rules, bots),
        trouble
          ? `${changed.bot}'s charter is written, and its rules are not. Settle what the line above says, then:  ${shellWord(ownCli())} rules build --bots ${shellWord(bots)} --bot ${changed.bot}`
          : `${changed.bot}'s charter is changed. A session that is running read the old one when it started; it reads this one when it next starts.`,
      );
      // The rules a charter grants are the user's to say yes to again, so the
      // change names what is allowed now and writes none of it (#353).
      // An allow list that is not a list is named by rules build and health,
      // and a charter already written is not undone for it.
      const bot = readBot(changed.home, changed.bot);
      if (values.allow === undefined && values.disallow === undefined && (runsOnClaude(bot) || runsOnCodex(bot))) {
        try {
          answer.beyondDefaults = beyondDefaults(bots, changed.home, bot);
          lines.push(...charterRulesLines(bots, bot, answer.beyondDefaults));
        } catch {
          // Nothing to name here.
        }
      }
    }
    if (values.allow !== undefined) {
      // Written at once, as the charter's rules are built at once (#344): the
      // harness's files first, bot.yaml last, so a write that fails leaves
      // `allow` as it was, and the same command can run again (#383).
      const permissions = allowInto();
      const allowed = allowRules(bots, values.bot, values.allow);
      Object.assign(answer, { allow: allowed.allow, permissions });
      const codex = permissions.find((entry) => entry.unwritten !== undefined);
      lines.push(
        ...allowed.added.map((rule) => `${'allowed'.padEnd(9)}  ${rule}`),
        ...permissionsLines(permissions, bots),
        // Codex reads its rules when a session starts, not while it runs.
        ...(codex === undefined || codex.written.length === 0 ? [] : [
          `Codex reads ${codex.file} when a session starts: a Codex session of ${allowed.bot} that is running now gets these rules at its next start (obk restart).`,
        ]),
        allowed.added.length === 0
          ? `${allowed.bot} was allowed every one of these already.`
          : `${allowed.bot}'s allow list in ${path.join('bots', allowed.bot, 'bot.yaml')} holds the user's yes.`,
      );
    }
    if (values.disallow !== undefined) {
      // The harness's files first, bot.yaml last: a write that fails leaves the
      // rules in `allow`, so the same command can take them back again (#360).
      const permissions = takeBackFrom();
      const taken = disallowRules(bots, values.bot, values.disallow);
      Object.assign(answer, { allow: taken.allow, disallowed: taken.disallowed, permissions });
      const codex = permissions.find((entry) => entry.unwritten !== undefined);
      lines.push(
        ...taken.disallowed.map((rule) => `${'took back'.padEnd(9)}  ${rule}`),
        ...permissions.filter((entry) => entry.removed?.length > 0).map((entry) => `${'wrote'.padEnd(9)}  ${path.relative(bots, entry.file)}  ${entry.removed.length} permission rule${entry.removed.length === 1 ? '' : 's'} taken out`),
        ...permissionsLines(permissions, bots),
        ...(codex === undefined || codex.removed.length === 0 ? [] : [
          `Codex reads ${codex.file} when a session starts: a Codex session of ${taken.bot} that is running now keeps ${codex.removed.length === 1 ? 'this rule' : 'these rules'} until its next start (obk restart).`,
        ]),
        `${taken.bot}'s allow list in ${path.join('bots', taken.bot, 'bot.yaml')} no longer holds ${taken.disallowed.length === 1 ? 'it' : 'them'}.`,
      );
    }
    return { answer, lines, code: trouble ? 1 : 0 };
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
    const asks = ['on', 'off', 'now', 'compact'].filter((flag) => values[flag] === true);
    if (asks.length > 1) {
      throw new Error(`groom asks for one thing at a time, and got ${asks.map((flag) => `--${flag}`).join(' and ')}. Say which one you want.`);
    }
    if (values.at !== undefined && asks.length === 1 && asks[0] !== 'on') {
      throw new Error(`--at is the time grooming runs at, and goes with --on, not with --${asks[0]}.`);
    }
    // --at on its own moves grooming that is on to another time.
    const ask = asks[0] ?? (values.at === undefined ? undefined : 'move');
    // What each run is launched with when it runs on Codex (#238): given only
    // with --run-on, and refused by grooming() when it is not.
    const given = ['run-on', 'model', 'effort', 'extra-arg'].some((flag) => values[flag] !== undefined);
    const run = !given ? undefined : {
      harness: values['run-on'],
      ...(values.model === undefined ? {} : { model: values.model }),
      ...(values.effort === undefined ? {} : { effort: values.effort }),
      ...(values['extra-arg'] === undefined ? {} : { extra_args: values['extra-arg'] }),
    };
    const groom = grooming(bots, { at: values.at, ask, run });
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
    const permissions = rules.flatMap((entry) => permissionsOf(bots, entry.bot));
    const trouble = [...rules, ...permissions].filter((entry) => entry.trouble !== undefined);
    return {
      answer: { bots, rules, permissions },
      lines: [
        ...rulesLines(rules, bots),
        ...permissionsLines(permissions, bots),
        trouble.length === 0
          ? `Rules are built. Your bots folder: ${bots}`
          // Not "not built": the file itself may be fine and the trouble be
          // the CLAUDE.md beside it, which is a bot whose rules still do not
          // reach both harnesses.
          : `${[...new Set(trouble.map((entry) => entry.bot))].join(', ')}: the rules are not in place. Settle what the lines above say, then build again.`,
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

  async 'message send'(bots, values) {
    const tab = callerTab(bots, values.from === undefined);
    refuseWhenOrcaIsDown();
    const answer = await sendMessage(bots, {
      to: values.to,
      from: values.from,
      tab,
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
    // Named or not, the mail is read as the caller's own terminal when it has one.
    const tab = callerTab(bots, values.bot === undefined || process.env[TERMINAL_ENV] !== undefined);
    refuseWhenOrcaIsDown();
    const answer = checkMail(bots, {
      bot: values.bot,
      session: values.session,
      tab,
      peek: values.peek === true,
    });
    const where = `${answer.bot}/${answer.session}`;
    const messages = answer.messages.flatMap((message) => [
      `${'message'.padEnd(9)}  ${message.from}  ${message.at}`,
      `             ${message.subject}`,
      ...String(message.body ?? '').split('\n').map((line) => `             ${line}`),
    ]);

    // Trouble after some mail was read still shows that mail: it is read, and
    // Orca will not hand it over again.
    if (answer.trouble !== undefined) {
      return { answer, lines: [...messages, `${'trouble'.padEnd(9)}  ${where}`, `             ${answer.trouble}`], code: 1 };
    }

    return {
      answer,
      lines: [
        ...messages,
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

  async 'session mailbox'(bots, values) {
    const answer = await ownMailbox(bots, values.bot, values.session);
    const who = `${answer.bot}/${answer.session}`;
    const said = {
      made: `${who} has its mailbox ${answer.mailbox}, made in this tab.`,
      bound: `${who}'s mailbox ${answer.mailbox} is bound to this tab.`,
      replaced: `${who}'s mailbox ${answer.replaced} is not one this Orca has, as when the book was written on another machine, so it has a new one, ${answer.mailbox}, made in this tab and written into the book.`,
      none: `${who} gets no mailbox: it is a Codex session with its sandbox switch off, which could not read one.`,
    };
    return { answer, lines: [said[answer.change]] };
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

  async 'session clear'(bots, values) {
    refuseWhenOrcaIsDown();
    const cleared = await clearSession(bots, { bot: values.bot, session: values.session });
    const after = cleared.was === null ? '' : `, in place of ${cleared.was}`;
    return {
      answer: { bots, cleared },
      lines: [`cleared    ${cleared.bot} ${cleared.session}: the book holds its new conversation ${cleared.now}${after}.`],
    };
  },

  async 'session compact'(bots, values) {
    refuseWhenOrcaIsDown();
    const compacted = await compactSession(bots, { bot: values.bot, session: values.session });
    const what = `${compacted.bot} ${compacted.session}`;
    return {
      answer: { bots, compacted },
      lines: [compacted.confirmed
        ? `compacted  ${what}: the harness's record of its conversation ${compacted.conversation} shows the compaction.`
        : `asked      ${what} to compact: /compact went in, and after 5 minutes the harness's record shows no compaction, so it is not confirmed yet. Look at its tab.`],
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
    // A refused call is not re-sent by another road (PRD 6.9), so the answer
    // says what to do instead, before the bot needs it (#521).
    return [
      `             Write to ${answer.address} with your own harness's messaging. The kit does not carry that road.`,
      "             If your harness refuses that call, do not send the message again by another road. Tell your maker or your user that it was refused, with the harness's reason. A refusal can mean a missing permission rule, which they can add through the kit after the user's yes.",
    ];
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
  const seconds = answer.watchedMs === undefined ? '' : ` in ${Math.max(Math.round(answer.watchedMs / 1000), 1)} s`;
  if (answer.signal === 'orca') return `             Orca's notice reached it${seconds}, so no line was typed: it reads the mail from there.`;
  if (answer.signal === 'hook') {
    return answer.because === 'busy'
      ? "             it is busy with a turn, so nothing was typed into its tab: its own hook tells it about the mail when that turn ends."
      : `             a turn of other work started in its tab${seconds}, not Orca's notice, so nothing was typed: its own hook tells it about the mail when that turn ends.`;
  }
  const why = {
    'no-turn': `no turn started in its tab in ${WATCH_SECONDS} s, so the kit's line was typed`,
    busy: "it is busy with a turn, and Codex takes a line into the turn it is having, so the kit's line was typed",
    'other-turn': "a turn of other work started in its tab, not Orca's notice, so the kit's line was typed",
  }[answer.because];
  const head = why === undefined ? '             ' : `             ${why}: `;
  if (answer.nudged && answer.nudgeWatched === false) {
    return `${head}its tab was typed into, and Orca could not say whether it was taken: ${answer.nudgeUnseen} The message waits in its mailbox for its next check either way.`;
  }
  if (answer.nudged && answer.nudgeUnseen !== undefined) {
    return `${head}its tab was typed into, but Orca did not see the line start a turn: it may be queued behind the work in hand, or lost. The message waits in its mailbox for its next check either way.`;
  }
  if (answer.nudged) return `${head}its tab was told to look; it will read it when it is done with what it is doing.`;
  if (answer.blocked !== undefined) {
    return `             its tab has something waiting to be answered (${answer.blocked}), so nothing was typed into it. Settle that, and the mail is there.`;
  }
  if (answer.nudgeLeft) {
    return `             it is queued, and its tab could not be told to look from here: ${answer.nudgeTrouble}. So the nudge is left for this session's hook, which looks at the tab from outside Codex's sandbox when this command is done, and says what it did.`;
  }
  if (answer.nudgeTrouble !== undefined) {
    return `             it is queued, and its tab could not be told to look: ${answer.nudgeTrouble}`;
  }
  return `             ${where} is not up, so nothing was typed anywhere: the message waits in its mailbox.`;
}

/** The watch before the kit's line, as the send says it (#509, ADR 0035). */
const WATCH_SECONDS = WATCH_MS / 1000;

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

/** The tabs a command closed, one line each. */
const closedLines = (closed) => closed.map((tab) => `closed     ${tab.bot} ${tab.name}  tab ${tab.tabId}  terminal ${tab.terminal}`);

/** The temporary sessions a retire took along with the one it named, each as it went (#464). */
const withLines = (retiredWith, session) => retiredWith.flatMap((gone) => [
  ...closedLines(gone.closed),
  `retired    ${gone.bot} ${gone.session}, a temporary session of ${gone.maker}'s, along with ${session}: off ${path.join('bots', gone.bot, 'bot.yaml')}, and its conversations kept in the book under retired`,
  ...unreadLines(gone.unread),
  ...processLines(gone.processes),
  ...leftLines(gone.promptsLeft),
]);

/** The mail a retired session did not read, as far as the kit knows (#509). */
const unreadLines = (unread, who = 'it') => (unread === undefined ? [] : [`unread     ${unreadWords(unread, who)}`]);

/** What a retire stopped of what its sessions left running, and what it named and left (#537). */
function processLines(processes) {
  if (processes === undefined) return [];
  if (processes.unreadable !== undefined) return [`processes  the kit cannot tell which processes were left running in the work dir, so it stopped none: ${processes.unreadable}`];
  return [
    ...processes.stopped.map((one) => `stopped    pid ${one.pid} of ${one.session}, with ${one.signal}: ${one.command}${one.cwd === null ? '' : `  in ${one.cwd}`}`),
    ...processes.left.map((one) => `left       pid ${one.pid} in ${one.cwd ?? 'a folder lsof did not name'}: ${one.command}. Not stopped: ${one.why}.`),
  ];
}

/** What a retire could not remove, and how to: nothing reads these files now (#393). */
const leftLines = (left = []) => left.flatMap(({ file, reason }) => [
  `left       ${file}: it could not be removed (${reason}). Nothing reads it now.`,
  `           Remove it with:  rm ${shellWord(file)}`,
]);

/** A context window written as a plain number stays one in the file. */
const asNumberOrText = (value) => (/^\d+$/.test(value) ? Number(value) : value);

const oneLine = (value) => (Array.isArray(value) ? value.join(' ') : String(value)).replace(/\s+/g, ' ').trim();

/**
 * The Orca tab this command runs in, with the caller taken to be the session
 * there only once sessionInTab has shown it is, when the command takes its
 * caller from the tab (#408). Asked before Orca is: a Codex that Orca brought
 * back by itself may run in a sandbox that cannot reach Orca at all, and
 * "Orca is not ready" would send its user the wrong way.
 */
function callerTab(bots, takesCaller) {
  const tab = process.env[TAB_ENV];
  if (takesCaller && tab !== undefined) sessionInTab(bots, tab);
  return tab;
}

function refuseWhenOrcaIsDown() {
  const trouble = orcaTrouble();
  if (trouble !== undefined) throw new Error(trouble);
}

/** The same facts as `--json`, as lines, for a person reading along. */
/** The one line that says which conversation this tab was given, and from where. */
const howLines = (tab) => {
  if (tab.resumed === true) return ['             it was told to resume the session the book holds, with its conversation.'];
  if (tab.noConversation === undefined) return ['             it was told to start a new session: the book holds none for this one yet.'];
  return [
    `             it was told to start a new session: the book's conversation ${tab.noConversation} had nothing on record`,
    "             behind it, so it went into the session's history.",
  ];
};

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
      lines.push(`${'session'.padEnd(9)}  ${session.name}${'retired' in session ? `  retired ${session.retired}` : ''}`);
      const notCounted = notCountedLine(session.not_counted);
      lines.push(...session.conversations.map(conversationLine));
      if (session.conversations.length === 0 && notCounted.length === 0) lines.push('             nothing on record');
      lines.push(...notCounted);
    }
    if (entry.unclaimed.length > 0 || notCountedLine(entry.unclaimed_not_counted).length > 0) {
      lines.push(`${'unclaimed'.padEnd(9)}  ${entry.bot}: no session of this bot claims these`);
      lines.push(...entry.unclaimed.map(conversationLine));
      lines.push(...notCountedLine(entry.unclaimed_not_counted));
    }
  }

  lines.push(usage.length === 0
    ? `No bots yet. Your bots folder: ${bots}`
    : `${usage.length} bot${usage.length === 1 ? '' : 's'}. What a token costs is yours to look up. Your bots folder: ${bots}`);
  return lines;
}

/** What could not be counted, as one line, or no line when everything was. */
function notCountedLine(gaps) {
  const said = [
    [gaps.unreadable_transcripts, 'transcript', 'transcripts', 'unreadable'],
    [gaps.broken_lines, 'line', 'lines', 'broken'],
    [gaps.records_without_numbers, 'record', 'records', 'with no usable number'],
    [gaps.records_without_time, 'record', 'records', 'with no time'],
  ]
    .filter(([count]) => count > 0)
    .map(([count, one, many, why]) => `${count} ${count === 1 ? one : many} ${why}`);
  return said.length === 0 ? [] : [`             not counted: ${said.join(', ')}`];
}

/** One conversation: what it is, what it ran as, and what it used. */
function conversationLine(one) {
  const ran = [...one.models, ...one.efforts].join(' ');
  const used = Object.entries(one.tokens)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind} ${count}`)
    .join('  ');
  return `             ${one.id}  ${one.calls} call${one.calls === 1 ? '' : 's'}`
    + `${one.subagent_calls > 0 ? `  of which subagents: ${one.subagent_calls} call${one.subagent_calls === 1 ? '' : 's'}` : ''}`
    + `${one.review_calls > 0 ? `  of which Codex's auto-review: ${one.review_calls} call${one.review_calls === 1 ? '' : 's'}` : ''}`
    + `${ran === '' ? '' : `  ${ran}`}`
    + `${used === '' ? '' : `  ${used}`}`
    + `${one.compactions > 0 ? `  compacted ${one.compactions}` : ''}`;
}

/**
 * What there is to say about the daily grooming: the session it runs in, the
 * jobs scheduled there, and what this run asked of it. Grooming that is off is
 * not a fault, so this says what is there and what the next step would be;
 * no job where one was expected, or more than one, is said plainly, because
 * either means the fleet is groomed a different number of times a day than
 * anyone decided.
 */
function groomLines({ session, jobs, asked }, bots) {
  const head = 'groom'.padEnd(9);
  const more = ' '.repeat(11);
  const said = asked === null ? [] : [ASKED[asked]];

  if (session === null) {
    return [
      ...said,
      `${head}  off: Bot Father has no session called grooming, which is where it runs`,
      `${more}It runs in that session, on Claude Code's own scheduler. Give the session`,
      `${more}--model and --effort for what each run is to use.`,
      `Add it:    ${addCommand(bots)}`,
      `Then:      ${upCommand(bots)}`,
    ];
  }
  if (session.harness !== 'claude') {
    return [
      ...said,
      `${head}  off: Bot Father's grooming session runs on ${session.harness}, and grooming runs`,
      `${more}on Claude Code's own scheduler, so it has to be a Claude Code session: retire`,
      `${more}it and add it again with --harness claude.`,
    ];
  }

  const lines = [...said];
  if (!session.up) {
    lines.push(`${head}  Bot Father's grooming session is not up, so nothing fires`);
    lines.push(`Bring it up:  ${upCommand(bots)}`);
  }
  if (asked === null) lines.push(...jobLines(jobs, bots, session.up ? head : more));
  lines.push(`${more}It fires only while its tab is up in Orca and Claude Code is idle there, up to`);
  lines.push(`${more}half an hour after its time, and a run it misses is not made up.`);
  return lines;
}

/** What is scheduled in the grooming session's conversation. */
function jobLines(jobs, bots, head) {
  const more = ' '.repeat(11);
  if (jobs.length === 0) {
    return [
      `${head}  off: its conversation has no grooming job`,
      `${more}It spends tokens every day. Run it by hand first:  ${groomCommand(bots)} --now`,
      `Turn it on, once the user has read a run and said yes:  ${groomCommand(bots)} --on --at 04:00`,
    ];
  }
  if (jobs.length === 1) {
    const [job] = jobs;
    return [
      `${head}  on, daily at ${job.at ?? job.cron}  job ${job.id}`,
      ...(job.run === undefined ? [] : [`${more}Each run is a temporary ${job.run.harness} session: model ${job.run.model ?? `${job.run.harness}'s own`}, effort ${job.run.effort ?? `${job.run.harness}'s own`}.`]),
      `${more}Each run renews it; with no run, Claude Code ends it at ${job.expires}.`,
      `Turn it off:  ${groomCommand(bots)} --off`,
    ];
  }
  const times = [...new Set(jobs.map((job) => job.at))];
  return [
    `${head}  ${jobs.length} grooming jobs, so the fleet is groomed ${jobs.length} times a day: ${jobs.map((job) => `${job.id} at ${job.at ?? job.cron}`).join(', ')}`,
    `Back to one:  ${groomCommand(bots)} --on${times.length === 1 && times[0] !== undefined ? '' : ' --at <HH:MM>'}`,
  ];
}

/** What each ask typed into the grooming tab, as the line that says so. */
const ASKED = {
  on: `${'asked'.padEnd(9)}  the grooming session to schedule the grooming, in a line typed into its tab. It is listed once the session has done it.`,
  off: `${'asked'.padEnd(9)}  the grooming session to delete its grooming jobs, in a line typed into its tab.`,
  now: `${'asked'.padEnd(9)}  the grooming session to run the grooming once, now. Its report goes to Bot Father's management session.`,
  compact: `${'asked'.padEnd(9)}  the grooming session to compact its conversation: /compact was typed into its tab.`,
};

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
    ...(book.temporary === undefined ? [] : [`             temporary, made by ${book.temporary.maker}${book.temporary.made === undefined ? '' : ` at ${book.temporary.made}`}`]),
    ...(book.session === undefined ? [] : [`             conversation ${book.session}`]),
    ...(book.history ?? [])
      .filter((was) => was?.session !== undefined)
      .map((was) => `             was ${was.session}${was.ended === undefined ? '' : `  ${was.ended}`}`),
    ...(book.unclaimed ?? []).map((id) => `             unclaimed ${id}`),
  ];
}

/**
 * The permission rules of one bot, written as `rules build` writes them: its
 * entry, one with the trouble that stopped it, or none for a bot that does not
 * run on Claude. A bot.yaml that cannot be read is the rules build's to report.
 */
function permissionsOf(bots, name) {
  const home = botDir(bots, name);
  let bot;
  try {
    bot = readBot(home, name);
  } catch {
    return [];
  }
  return writePermissions(bots, home, bot, { keepGoing: true });
}

/**
 * What a charter change says about the permission rules: the ones the bot is
 * allowed now beyond the kit's defaults, word for word, which stay allowed, and
 * that a new one is written only after the user's yes to the new charter's.
 */
function charterRulesLines(bots, bot, rules) {
  const name = bot.name;
  const until = `No new rule is written until the user answers: list the rules the new charter grants, show them to the user word for word, and allow the ones they say yes to with  ${shellWord(ownCli())} bot change --bots ${shellWord(bots)} --bot ${shellWord(name)} --allow <rule>`;
  if (rules.length === 0) return [`${name} is allowed no permission rules beyond the kit's defaults. ${until}`];
  const settings = runsOnClaude(bot) ? ` and ${path.join('bots', name, '.claude', 'settings.json')}` : '';
  // The kit owns the Codex file whole and rewrites it from bot.yaml (#354).
  const codex = runsOnCodex(bot) ? `, and the kit then rewrites ${path.join(bots, 'bots', name, '.codex', 'rules', 'obk.rules')} without it` : '';
  return [
    `${name} is allowed these permission rules beyond the kit's defaults, from before this change:`,
    ...rules.map((rule) => `             ${rule}`),
    `They stay allowed, whatever the user answers, until the user says yes to taking one back out of ${path.join('bots', name, 'bot.yaml')}${settings}${codex}. For one the new charter no longer grants, ask the user, and only after their yes run  ${shellWord(ownCli())} bot change --bots ${shellWord(bots)} --bot ${shellWord(name)} --disallow <rule>. ${until}`,
  ];
}

/**
 * What became of each bot's permission rules: the file the allowed ones were
 * written into, and the kit's rules that still wait for the user's yes, each
 * word for word, with the one command that allows them once the user has said
 * it (#344). Nothing for a bot with nothing written and nothing waiting.
 */
function permissionsLines(permissions, bots) {
  // A bot on both harnesses has an entry for each file, and what waits for
  // Codex is also waiting for Claude: the rules are listed once, with the first.
  const listed = new Set();
  return permissions.flatMap((entry) => [
    ...(entry.trouble === undefined ? [] : [`${'refused'.padEnd(9)}  ${entry.trouble}`]),
    ...(entry.written.length === 0
      ? []
      : [`${'wrote'.padEnd(9)}  ${path.relative(bots, entry.file)}  ${entry.written.length} permission rule${entry.written.length === 1 ? '' : 's'} the user allowed`]),
    // What the user allowed and Codex has no form for is said at every build,
    // so a bot given a Codex session later hears of it too (#354). For a bot
    // only on Codex, `--allow` refused it already.
    ...(entry.unwritten ?? []).map((one) => `${'not'.padEnd(9)}  written for Codex: ${one.rule}. ${one.why}.`),
    ...(entry.waiting.length === 0 || listed.has(entry.bot) || !listed.add(entry.bot) ? [] : [
      `${'waiting'.padEnd(9)}  ${entry.bot}: these permission rules wait for the user's yes, and none of them is written until then:`,
      ...entry.waiting.map((rule) => `             ${rule}`),
      `             Show them to the user. Once they say yes:  ${allowCommand(bots, entry.bot, entry.waiting)}`,
    ]),
  ]);
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
    ...(entry.sessions ?? []).map((one) => toldLine(entry.bot, one)),
  ]);
}

/** What `skills build` did about one running session of a bot whose skills changed. */
function toldLine(bot, { session, harness, state, read, blocked, trouble }) {
  const who = `${bot}/${session}`;
  const after = harness === 'claude' ? 'Once that is settled, type /reload-skills in its tab.' : 'Its next turn takes the change by itself.';
  const [word, says] = {
    reloaded: ['reloaded', '/reload-skills was typed into its tab; a busy session runs it when its turn ends'],
    'next-turn': ['next turn', `Codex takes the change at the start of its next turn. If a skill is not there then, a restart makes it appear${read?.length > 0 ? `; meanwhile it can read ${read.join(', ')}` : ''}`],
    'not-up': ['not told', 'not up; it reads its skills when it starts'],
    blocked: ['not told', `its tab is waiting for an answer (${blocked}), so nothing was typed. ${after}`],
    unknown: ['not told', `${trouble}. ${after}`],
  }[state];
  return `  ${word.padEnd(9)}  ${who.padEnd(24)}  ${says}`;
}

/**
 * What a check found, two lines each: what kind of trouble it is and the one
 * thing to go and look at, then the sentence about it. The same shape wherever
 * a command reports one, so a reader who has seen one has seen them all.
 */
const foundLines = (found) =>
  found.flatMap((one) => [`${one.kind.padEnd(9)}  ${one.where}`, `             ${one.says}`]);

/**
 * What one running session runs on, in a line: each setting's state, with what
 * was asked for and what the harness recorded, and its rules.
 */
function settingsLine({ bot, session, running, settings, rules }) {
  const each = Object.entries(settings).map(([name, one]) => {
    const values = [
      ...(one.configured === undefined ? [] : [`asked ${one.configured}`]),
      ...(one.observed === undefined ? [] : [`runs ${one.observed}`]),
    ];
    return `${name} ${one.state}${values.length === 0 ? '' : ` (${values.join(', ')})`}`;
  });
  // A session whose harness the kit cannot see in its tab is not called running.
  const [word, who] = running === 'yes'
    ? ['running', `${bot} ${session}`]
    : ['unsure', `${bot} ${session}  cannot tell whether its harness is running:`];
  return `${word.padEnd(9)}  ${who}  ${each.join('  ')}  rules ${rules.state}`;
}

function tabLines({ bots, created, completed, rules, skills, permissions = [], tabs, paused = [], projects = [], found = [] }, summary) {
  const lines = [
    ...created.map((entry) => `created    ${entry}`),
    ...completed.map((entry) => `completed  ${entry}`),
    ...rulesLines(rules, bots),
    ...skillsLines(skills),
    ...permissionsLines(permissions, bots),
  ];

  for (const tab of tabs) {
    lines.push(`${tab.created ? 'opened' : 'found '}     ${tab.title}  tab ${tab.tabId}  terminal ${tab.terminal}`);
    lines.push(...harnessLines(tab, bots));
    if (tab.noMailbox) {
      lines.push(`             it has no mailbox: ${noMailboxYet({ bots, bot: tab.bot, session: tab.name })}`);
    }
  }
  for (const one of paused) {
    const what = one.session === undefined ? one.bot : `${one.bot} ${one.session}`;
    const back = one.session === undefined ? '' : ` --session ${one.session}`;
    lines.push(`${'paused'.padEnd(9)}  ${what}  left closed. Bring it back:  ${shellWord(ownCli())} unpause --bots ${shellWord(bots)} --bot ${one.bot}${back}`);
  }

  // Last before the summary, because what a check found is about the setup the
  // run has just left behind rather than about any one thing it did.
  lines.push(...foundLines(found));
  // Hedged, because nothing here can see whether the window was told (#224).
  if (projects.length > 0) lines.push(RELOAD_LINE);
  lines.push(summary);
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

  // Nothing was typed into it, so there is nothing more to say about a harness
  // (#498).
  if (tab.launched === false) {
    return [
      `             not launched: ${tab.notLaunched}. Nothing was typed into it.`,
      `             Look at it:  ${lookAt(tab.terminal)}`,
      '             Answer it in the tab, then start the session again in a new tab:',
      `               ${shellWord(ownCli())} restart --bots ${shellWord(bots)} --bot ${tab.bot} --session ${tab.name}`,
    ];
  }

  // What the line that was typed in asked for, and where the kit got it: the
  // session the book holds, one the harness itself still had on record, or a new
  // one — and if a new one, whether anything was known about an older one.
  const how = howLines(tab);

  if (!tab.harnessStarted) {
    return [
      ...how,
      '             the harness was typed in, and no session came up in the tab.',
      `             Look at it:  ${lookAt(tab.terminal)}`,
      ...ANSWER_IT,
      ...promptLines(tab),
    ];
  }

  // Orca naming no reason does not mean nothing is on screen: on 1.4.209 it
  // names none for Codex's trust and hooks screens, nor for Claude Code's trust
  // list (tech notes, section 1, #288). So the kit says what it cannot see.
  const lines = tab.blockedReason === undefined
    ? [
      ...how,
      '             the harness was typed in and is running. The kit cannot see whether a screen',
      '             in it is waiting for an answer.',
      `             Look at it:  ${lookAt(tab.terminal)}`,
      ...ANSWER_IT,
    ]
    : [
      ...how,
      `             the harness was typed in and came up, waiting on: ${tab.blockedReason}`,
      `             Look at it:  ${lookAt(tab.terminal)}`,
      ...ANSWER_IT,
    ];

  lines.push(...promptLines(tab), ...listLines(tab));
  if (tab.unclaimed !== undefined) lines.push(...unclaimedLines(tab, bots));
  return lines;
}

/**
 * Whether a resumed Codex session was typed its one line so Orca lists it among
 * its agents, which it does only from a session's first turn (#226).
 */
function listLines(tab) {
  if (tab.listLine === true) return ['             it was typed one line so Orca lists it among its agents: Codex tells Orca only at a first turn.'];
  if (tab.listLine === false) return [`             it was not typed the line that makes Orca list it (${tab.listLineTrouble}): Orca lists it at its next turn.`];
  return [];
}

/**
 * Whether the session got its start prompt, as its own record has it (#274):
 * received, or not confirmed yet. Nothing for a session that was told nothing.
 */
function promptLines(tab) {
  if (tab.promptReceived === true) return ['             the start prompt was received: the session\'s own record holds it.'];
  if (tab.promptReceived === false) return ['             the start prompt is not confirmed: the session\'s own record does not hold it yet.'];
  return [];
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`obk: ${error.message}\n`);
  process.exitCode = 1;
}
