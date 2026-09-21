#!/usr/bin/env node

// `obk` — the Orca Bot Kit command line. Bot Father's skills call it; a person
// can too. It writes files and reports what it did; it never commits.
//
// The caller is normally an LLM running a setup step, so every command says
// plainly what it made and what still wants looking at, and `--json` gives it
// the same facts to act on.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { addSession, createBot, readBot, SESSION_FIELDS } from './bot.js';
import { initBots } from './init.js';
import { APPROVALS, HARNESSES } from './launch.js';
import { checkMail, lookUp, sendMessage } from './message.js';
import { orcaTrouble } from './orca.js';
import { recordSession, SHELL_ENV, TAB_ENV } from './record.js';
import { buildAgents, buildRules, CODEX_CAP } from './rules.js';
import { buildSkills, linkSkills } from './skills.js';
import { fetchSources } from './sources.js';
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
  obk rules build --bots <path> [--bot <bot>]
                            Build every bot's AGENTS.md from its charter and
                            the rule units it carries, or just the one you
                            name. Your own text outside the marked block is
                            kept; a block you edited by hand is reported and
                            never written over. It does not touch Orca.
  obk skills build --bots <path> [--bot <bot>]
                            Link every bot's skills into both harnesses, or
                            just the one you name, from the kit, your own
                            skills folder, or any path. What you put in a
                            bot's skills directory yourself is left alone and
                            shown as yours. It does not touch Orca.
  obk skills fetch --bots <path> [--source <name>]
                            Clone the online sources skills.yaml lists, beside
                            your bots folder and never inside it, each at the
                            version you pinned, and write down the sha it got.
                            A source already there is left exactly as it is.
  obk skills update --bots <path> [--source <name>]
                            Move a source on to what its ref names now, and
                            write down the new sha. This is the only thing that
                            moves one.
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
  obk session record --bots <path> --bot <bot>
                            For the kit's own hook, not for typing: it reads
                            what the harness says about a session starting on
                            standard input and writes it into the book.
  obk --version             Print the kit's version.
  obk --help                Print this text.

Every command is safe to run again: they add what is missing and nothing else.
Add --json to any of them for the same answer as JSON.
`;

/** The commands, and the flags each one cannot do without. */
const COMMANDS = {
  init: ['bots', 'harness'],
  up: ['bots'],
  'bot create': ['bots', 'name', 'harness'],
  'rules build': ['bots'],
  'skills build': ['bots'],
  'skills fetch': ['bots'],
  'skills update': ['bots'],
  'session add': ['bots', 'bot', 'name'],
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

  // `bot`, `rules`, `skills` and `session` are commands of two words; the rest are one.
  const words = ['bot', 'rules', 'skills', 'session', 'message'].includes(positionals[0]) ? 2 : 1;
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

  const bots = path.resolve(values.bots);
  if (command === RECORD) return record(bots, values.bot);

  const { answer, lines, code = 0 } = await commands[command](bots, values);

  process.stdout.write(values.json ? `${JSON.stringify(answer, null, 2)}\n` : `${lines.join('\n')}\n`);
  return code;
}

/** The one command a harness runs rather than a person: the kit's hook. */
const RECORD = 'session record';

/**
 * What the kit's hook does with what the harness told it, and what it answers.
 *
 * A hook runs inside the user's own session, so this one stays out of the way:
 * it writes on standard output only what the harness is to read as JSON, and
 * whatever goes wrong, it goes wrong quietly. A book left stale is a thing the
 * health check finds later; a session disturbed is the user's work (ADR 0010).
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
    const { tabs, rules, skills } = await bringUp(seeded.bots, { bot: BOT_FATHER });
    const answer = { bots: seeded.bots, created: seeded.created, completed: seeded.completed, rules, skills, tabs };
    return { answer, lines: tabLines(answer, `Bot Father is up in Orca. Your bots folder: ${seeded.bots}`) };
  },

  async up(bots, values) {
    refuseWhenOrcaIsDown();
    const { tabs, rules, skills } = await bringUp(bots, { bot: values.bot, session: values.session });
    const answer = { bots, created: [], completed: [], rules, skills, tabs };
    const up = [...new Set(tabs.map((tab) => tab.bot))];
    const summary = up.length === 0
      ? `Nothing was brought up in Orca. Your bots folder: ${bots}`
      : `Up in Orca: ${up.join(', ')}. Your bots folder: ${bots}`;
    return { answer, lines: tabLines(answer, summary) };
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
          ? `${made.bot} is written, and its rules are not. Settle what the line above says, then:  obk rules build --bots ${bots} --bot ${made.bot}`
          : `${made.bot} is written. Give it a session:  obk session add --bots ${bots} --bot ${made.bot} --name <name>`,
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
        answer.trouble !== undefined
          ? `             ${answer.trouble}`
          : (answer.transport === 'native'
            ? `             Write to ${answer.address} with your own harness's messaging. The kit does not carry that road.`
            : `             Send it:  obk message send --bots ${bots} --to ${where} --subject <text> --text <text>`),
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
        answer.nudged
          ? `             its tab was told to look; it will read it when it is done with what it is doing.`
          : `             ${where} is not up, so nothing was typed anywhere: the message waits in its mailbox.`,
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
    const answer = { bots, bot: added.bot, home: added.home, session: added.session };
    return {
      answer,
      lines: [
        `added      session ${added.session.name} to ${path.join('bots', added.bot, 'bot.yaml')}`,
        ...Object.entries(added.session)
          .filter(([key]) => key !== 'name')
          .map(([key, value]) => `           ${key}  ${oneLine(value)}`),
        `Bring it up:  obk up --bots ${bots} --bot ${added.bot}`,
      ],
    };
  },
};

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

function tabLines({ bots, created, completed, rules, skills, tabs }, summary) {
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

  // What the line that was typed in asked for, and where the kit got it: the
  // session the book holds, one the harness itself still had on record, or a new
  // one — and if a new one, whether anything was known about an older one.
  const how = [howLine(tab)];

  if (!tab.harnessStarted) {
    return [
      ...how,
      '             the harness was typed in, and no session came up in the tab.',
      `             Look at it:  orca terminal read --terminal ${tab.terminal} --screen`,
    ];
  }

  const lines = tab.blockedReason === undefined
    ? [...how, '             the harness was typed in and came up.']
    : [
      ...how,
      `             the harness was typed in and came up, waiting on: ${tab.blockedReason}`,
      `             Look at it:  orca terminal read --terminal ${tab.terminal} --screen`,
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
