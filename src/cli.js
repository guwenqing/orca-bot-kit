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

import { addSession, createBot } from './bot.js';
import { initBots } from './init.js';
import { APPROVALS, HARNESSES } from './launch.js';
import { orcaTrouble } from './orca.js';
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
                  [--prompt <text>] [--work-dir <path>] [--extra-arg=<arg>]
                            Add a session to a bot. Anything left out is the
                            harness's own default; approval is auto.
                            A value of your own that starts with a dash is
                            given glued to its flag, so its dashes are not read
                            as ours: --prompt='- a bullet', and
                            --extra-arg=--search, once per extra argument.
  obk up --bots <path> [--bot <bot>] [--session <name>]
                            Open whatever is missing in Orca, for every bot or
                            for the one you name. It only ever adds; it never
                            closes a tab.
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
  'session add': ['bots', 'bot', 'name'],
};

/** What each flag is for, in the sentence a caller reads when it is missing. */
const NEEDED = {
  bots: '--bots <path>: where your bots folder is',
  name: '--name <name>: what to call it',
  bot: '--bot <bot>: which bot',
  session: '--session <name>: which session',
  harness: `--harness ${HARNESSES.join('|')}: which harness it runs on`,
};

/** The flags that name something. A name that is empty names nothing. */
const IDENTIFIERS = Object.keys(NEEDED);

/** The session settings, as flags and as they are written in bot.yaml. */
const SETTINGS = [
  ['harness', 'harness'],
  ['model', 'model'],
  ['effort', 'effort'],
  ['context', 'context'],
  ['approval', 'approval'],
  ['prompt', 'prompt'],
  ['work-dir', 'work_dir'],
];

function version() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}

function run(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      bots: { type: 'string' },
      harness: { type: 'string' },
      name: { type: 'string' },
      bot: { type: 'string' },
      session: { type: 'string' },
      charter: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      context: { type: 'string' },
      approval: { type: 'string' },
      prompt: { type: 'string' },
      'work-dir': { type: 'string' },
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

  // `bot` and `session` are commands of two words; the rest are one.
  const words = positionals[0] === 'bot' || positionals[0] === 'session' ? 2 : 1;
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
  const { answer, lines } = commands[command](bots, values);

  process.stdout.write(values.json ? `${JSON.stringify(answer, null, 2)}\n` : `${lines.join('\n')}\n`);
  return 0;
}

const commands = {
  init(bots, values) {
    // Asked before anything is written, so an Orca that is down leaves the disk
    // exactly as it was and the caller can simply run the command again.
    refuseWhenOrcaIsDown();
    const seeded = initBots(bots, values.harness);
    const tabs = bringUp(seeded.bots, { bot: BOT_FATHER });
    const answer = { bots: seeded.bots, created: seeded.created, completed: seeded.completed, tabs };
    return { answer, lines: tabLines(answer, `Bot Father is up in Orca. Your bots folder: ${seeded.bots}`) };
  },

  up(bots, values) {
    refuseWhenOrcaIsDown();
    const tabs = bringUp(bots, { bot: values.bot, session: values.session });
    const answer = { bots, created: [], completed: [], tabs };
    const up = [...new Set(tabs.map((tab) => tab.bot))].join(', ');
    return { answer, lines: tabLines(answer, `Up in Orca: ${up}. Your bots folder: ${bots}`) };
  },

  'bot create'(bots, values) {
    const made = createBot(bots, { name: values.name, harness: values.harness, charter: values.charter });
    const answer = { bots, bot: made.bot, home: made.home, created: made.created };
    return {
      answer,
      lines: [
        ...made.created.map((entry) => `created    ${entry}`),
        `${made.bot} is written. Give it a session:  obk session add --bots ${bots} --bot ${made.bot} --name <name>`,
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
function tabLines({ created, completed, tabs }, summary) {
  const lines = [
    ...created.map((entry) => `created    ${entry}`),
    ...completed.map((entry) => `completed  ${entry}`),
  ];

  for (const tab of tabs) {
    lines.push(`${tab.created ? 'opened' : 'found '}     ${tab.title}  tab ${tab.tabId}  terminal ${tab.terminal}`);
    lines.push(...harnessLines(tab));
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
function harnessLines(tab) {
  if (!tab.created || tab.name === null) return [];

  if (!tab.harnessStarted) {
    return [
      '             the harness was typed in, and no session came up in the tab.',
      `             Look at it:  orca terminal read --terminal ${tab.terminal} --screen`,
    ];
  }

  const lines = tab.blockedReason === undefined
    ? ['             the harness was typed in and came up.']
    : [
      `             the harness was typed in and came up, waiting on: ${tab.blockedReason}`,
      `             Look at it:  orca terminal read --terminal ${tab.terminal} --screen`,
    ];

  if (tab.promptSent === true) lines.push('             the start prompt was typed in.');
  if (tab.promptSent === false) {
    lines.push('             the start prompt was not typed in: the tab was not ready for it.');
  }
  return lines;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`obk: ${error.message}\n`);
  process.exitCode = 1;
}
