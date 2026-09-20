// What a session is started with: the one line typed into its tab, which brings
// the harness up and carries the session's start prompt with it.
//
// The flag mapping is PRD 6.4 and ADR 0005, re-checked against the installed
// CLIs (Claude Code 2.1.278, Codex 0.155.1). Every session is given its
// approval level explicitly, so a user's own global harness defaults cannot
// leak into a bot. The kit names no model: a session that sets none gets the
// harness's own.
//
// The text goes into the tab's ordinary shell, so every word is quoted the way
// a shell needs it. `claude --model sonnet[1m]` would be a glob to zsh.

import path from 'node:path';

/** The approval levels, and what each one is called on each harness. */
const APPROVAL = {
  claude: {
    auto: ['--permission-mode', 'auto'],
    ask: ['--permission-mode', 'manual'],
    'dangerously-skip': ['--dangerously-skip-permissions'],
  },
  codex: {
    auto: ['--approve-for-me'],
    ask: ['-a', 'on-request'],
    'dangerously-skip': ['--dangerously-bypass-approvals-and-sandbox'],
  },
};

export const APPROVALS = Object.keys(APPROVAL.claude);

export const HARNESSES = Object.keys(APPROVAL);

/** The level a session that names none runs at (ADR 0005). */
export const DEFAULT_APPROVAL = 'auto';

/** A setting the user left out. An empty string is one too: it means the harness's own. */
const set = (value) => value !== undefined && value !== null && String(value).trim() !== '';

/** Which harness a session runs on: its own, or the bot's. */
export const harnessOf = (session, botHarness) => (set(session.harness) ? session.harness : botHarness);

/** Where a session's work dir is: under the bot home, or wherever it says. */
export function workDirOf(session, home) {
  if (!set(session.work_dir)) return undefined;
  return path.resolve(home, session.work_dir);
}

/**
 * What a session asks for that cannot be done, in the user's own terms.
 *
 * Both commands that write a session check this, and so does the run that
 * starts one: a session can also arrive by hand, and a bot.yaml the user edited
 * is worth the same plain sentence rather than a stray flag typed into a tab.
 */
export function sessionTrouble(session, harness) {
  if (!HARNESSES.includes(harness)) {
    return `${where(session)} runs on ${harness}, and the harnesses are ${HARNESSES.join(' and ')}.`;
  }
  if (set(session.approval) && !APPROVALS.includes(session.approval)) {
    return `${where(session)} is set to approval ${session.approval}, and the levels are ${APPROVALS.join(', ')}.`;
  }
  // Codex is given the context window as a number of tokens. `1m` is what a
  // Claude session would say, and copying it here does not fail at the kit but
  // in Codex, which exits with a type error the moment it starts.
  if (harness === 'codex' && set(session.context) && !/^\d+$/.test(String(session.context).trim())) {
    return `${where(session)} sets a context of ${session.context} on Codex, and Codex counts that in tokens, as a whole number: 200000, for example. A context like 1m belongs on Claude Code, where it is part of the model name.`;
  }
  // On Claude Code the context window is a suffix on the model name, so there
  // is nothing to hang it on when no model was named.
  if (harness === 'claude' && set(session.context) && !set(session.model)) {
    return `${where(session)} sets a context on Claude Code but no model. On Claude Code the context is part of the model name (--model 'sonnet[1m]'), so give the session a model as well, or leave the context out.`;
  }
  return undefined;
}

const where = (session) => (set(session.name) ? `session ${session.name}` : 'this session');

/**
 * The line that starts the harness in a session's tab, with the session's start
 * prompt on the end of it as the harness's own prompt argument.
 *
 * Nothing is added for a setting the session left out, and the order is fixed:
 * approval, model, effort, context, work dir, whatever the user added, and the
 * prompt last, where a positional argument goes.
 *
 * The prompt rides on this line rather than being typed in afterwards, which is
 * what a first run in a fresh bots repo taught us: the harness may be showing
 * its folder-trust question, Claude Code's reads as idle to Orca, and a second
 * send would land on that list and answer it. A prompt given as an argument is
 * held by the harness until it is ready for it (tech notes, section 1).
 */
export function launchCommand(session, { harness, home, workDir, prompt }) {
  const trouble = sessionTrouble(session, harness);
  if (trouble !== undefined) throw new Error(trouble);

  const words = [harness, ...APPROVAL[harness][set(session.approval) ? session.approval : DEFAULT_APPROVAL]];

  if (harness === 'claude') {
    // The context window rides on the model name: `sonnet[1m]`.
    if (set(session.model)) words.push('--model', set(session.context) ? `${session.model}[${session.context}]` : session.model);
    if (set(session.effort)) words.push('--effort', String(session.effort));
  } else {
    if (set(session.model)) words.push('-m', session.model);
    if (set(session.effort)) words.push('-c', `model_reasoning_effort=${session.effort}`);
    if (set(session.context)) words.push('-c', `model_context_window=${session.context}`);
    // In Codex's auto mode the sandbox lets it write in the folder it was
    // started in, and nowhere else (ADR 0005), so a work dir outside the bot
    // home has to be named.
    if (workDir !== undefined && !inside(home, workDir)) words.push('--add-dir', workDir);
  }

  return [
    ...words.map(quoted),
    ...extraWords(session.extra_args),
    // `--` first: a prompt of the user's own may start with a dash — a
    // Markdown bullet does — and both harnesses would read it as an option of
    // theirs and refuse to start.
    ...(prompt === undefined ? [] : ['--', quoted(prompt)]),
  ].join(' ');
}

/**
 * What the session is told when it comes up, or undefined when it has nothing
 * to say. The work dir is named here and nowhere else: it is an instruction to
 * the session, not something the harness is told (PRD 6.4).
 *
 * Word for word as the user wrote it. It travels as one argument, quoted for
 * the shell it is typed into, so nothing has to be flattened to keep it whole:
 * the two spaces, the newlines and the indentation of a prompt that carries a
 * piece of text or code are the user's, and are none of the kit's business.
 */
export function startPrompt(session, workDir) {
  const note = workDir === undefined
    ? undefined
    : `Your work dir is ${workDir}. It is a plain folder the kit made for you, not a git worktree.`;

  // Only the ends are taken off — a `prompt: |` in YAML carries a newline the
  // user never typed. What is inside is theirs: the two spaces, the newlines,
  // the indent under a list.
  const said = [session.prompt, note].filter(set).map((part) => String(part).trim());
  return said.length === 0 ? undefined : said.join('\n\n');
}

/** Whether `target` is the folder at `home` or something inside it. */
const inside = (home, target) => target === home || target.startsWith(home + path.sep);

/**
 * The user's own `extra_args`. A list is a list of arguments, each quoted as
 * one. A plain string is the user's own shell text, typed as they wrote it.
 */
function extraWords(extra) {
  if (Array.isArray(extra)) return extra.filter(set).map((arg) => quoted(String(arg)));
  return set(extra) ? [String(extra).trim()] : [];
}

/** A word as a shell needs it. Anything a shell would read as more than a word is quoted. */
const quoted = (word) => (/^[A-Za-z0-9,._+:@%/=-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);
