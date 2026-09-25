// What a session is started with: the one line typed into its tab, which brings
// the harness up and carries the session's start prompt with it.
//
// The flag mapping is PRD 6.4 and ADR 0015, re-checked against the installed
// CLIs (Claude Code 2.1.278, Codex 0.155.1). Every session is given its
// approval level explicitly, so a user's own global harness defaults cannot
// leak into a bot. The kit names no model: a session that sets none gets the
// harness's own.
//
// The text goes into the tab's ordinary shell, so every word is quoted the way
// a shell needs it. `claude --model sonnet[1m]` would be a glob to zsh.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * How a permission bypass is spelled on a harness: the flags the
 * `dangerously-skip` level puts on the launch line, and the same ones Orca's
 * own default launch arguments carry when they carry a bypass (PRD 6.5).
 */
export const bypassFlags = (harness) => APPROVAL[harness]['dangerously-skip'];

export const HARNESSES = Object.keys(APPROVAL);

/** The level a session that names none runs at (ADR 0015). */
export const DEFAULT_APPROVAL = 'auto';

/** A setting the user left out. An empty string is one too: it means the harness's own. */
const set = (value) => value !== undefined && value !== null && String(value).trim() !== '';

/** Which harness a session runs on: its own, or the bot's. */
export const harnessOf = (session, botHarness) => (set(session.harness) ? session.harness : botHarness);

/**
 * A session's name on Claude Code, which is also the address another Claude
 * session writes to (ADR 0018). It goes on the launch line as `-n`, and it is
 * re-applied every time the session is started: a resume keeps the name by
 * itself (tech notes, section 2), and the kit does not depend on that.
 *
 * `<bot>.<session>` alone is not an address: every fleet with that bot and
 * session answers to it, old runs and throwaway test fleets included, and
 * Claude Code refuses a send to a name more than one session holds (#286). So
 * the name ends in a token of its own, made for each new conversation. A
 * resume keeps the name the book `held`, when it is one of these for this
 * bot and session; anything else gets a new one.
 */
export function addressOf(bot, session, held) {
  const own = `${bot}.${session}.`;
  if (typeof held === 'string' && held.startsWith(own) && /^[a-z0-9]{1,8}$/.test(held.slice(own.length))) return held;
  return own + randomBytes(3).toString('hex');
}

/**
 * The Codex setting without which a bot cannot reach Orca at all.
 *
 * Inside Codex's workspace-write sandbox the Orca CLI runs but cannot connect
 * to the running app, so `orca orchestration` is refused and a Codex bot can
 * neither read nor send fleet mail. With this switch on, the same session at
 * the same approval level reaches it (tech notes, section 3, proved live).
 * The widening is real and said plainly where the user sees the launch line:
 * that sandbox gains network access, there being no localhost-only setting.
 */
const NETWORK_ACCESS = 'sandbox_workspace_write.network_access';

/**
 * Whether the user has settled that switch themselves in this session's extra
 * arguments. Theirs wins, whichever way they set it: the kit adds nothing
 * beside it, and a session that turned it off is reported as out of reach of
 * fleet mail rather than quietly failing to answer.
 */
export const setsNetworkAccess = (session) =>
  extraWords(session.extra_args).some((word) => word.includes(NETWORK_ACCESS));

/**
 * Whether fleet mail can reach this session at all: everything but a Codex
 * session whose user turned the sandbox switch off.
 */
export const reachesMail = (session, harness) =>
  harness !== 'codex' || !turnedOff(session);

const turnedOff = (session) =>
  extraWords(session.extra_args).some((word) => word.includes(`${NETWORK_ACCESS}=false`));

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
export function sessionTrouble(session, harness, home) {
  if (set(session.prompt) && set(session.prompt_file)) {
    return `${where(session)} has both a prompt and a prompt file, and a session is told its duty once. Keep the one you meant.`;
  }
  // The file is the prompt, so a session that cannot be read cannot be started,
  // and saying so now beats a tab that comes up with nothing to do.
  if (set(session.prompt_file)) {
    try {
      readFileSync(promptFile(session, home), 'utf8');
    } catch (error) {
      return `${where(session)} has its prompt in ${session.prompt_file}, and that file cannot be read (${error.code}): ${promptFile(session, home)}. Write it, or point the session at the file you meant.`;
    }
  }
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
export function launchCommand(session, { harness, home, workDir, prompt, promptFile: fromFile, resume, address }) {
  const trouble = sessionTrouble(session, harness, home);
  if (trouble !== undefined) throw new Error(trouble);

  const words = [harness];
  // Codex resumes through a subcommand, which has to come first; Claude Code
  // resumes through a flag, which goes with the session id at the end. Both
  // take every other flag exactly as a fresh session does.
  if (resume !== undefined && harness === 'codex') words.push('resume');
  words.push(...APPROVAL[harness][set(session.approval) ? session.approval : DEFAULT_APPROVAL]);

  if (harness === 'claude') {
    // The name is the address other Claude sessions write to, so it goes on
    // every launch line, a resume included (ADR 0018).
    if (address !== undefined) words.push('-n', address);
    // The context window rides on the model name: `sonnet[1m]`.
    if (set(session.model)) words.push('--model', set(session.context) ? `${session.model}[${session.context}]` : session.model);
    if (set(session.effort)) words.push('--effort', String(session.effort));
  } else {
    // Without this the Orca CLI cannot reach Orca from inside the sandbox, so
    // the session is in no fleet at all. The user's own setting of it wins.
    if (!setsNetworkAccess(session)) words.push('-c', `${NETWORK_ACCESS}=true`);
    if (set(session.model)) words.push('-m', session.model);
    if (set(session.effort)) words.push('-c', `model_reasoning_effort=${session.effort}`);
    if (set(session.context)) words.push('-c', `model_context_window=${session.context}`);
    // In Codex's auto mode the sandbox lets it write in the folder it was
    // started in, and nowhere else (ADR 0015), so a work dir outside the bot
    // home has to be named.
    if (workDir !== undefined && !inside(home, workDir)) words.push('--add-dir', workDir);
  }

  return [
    // The shell's own pid, so the session's hook can tell the harness this line
    // starts — the shell's child — from anything the session starts later inside
    // the tab. `$$` is the shell's, and it is not quoted for that reason.
    `${SHELL_ENV}=$$`,
    `${CLI_ENV}=${quoted(ownCli())}`,
    ...words.map(quoted),
    ...extraWords(session.extra_args),
    ...resumeWords(harness, resume),
    // `--` first: a prompt of the user's own may start with a dash — a
    // Markdown bullet does — and both harnesses would read it as an option of
    // theirs and refuse to start.
    ...promptWords(prompt, fromFile),
  ].join(' ');
}

/**
 * What the session is told when it comes up, or undefined when it has nothing
 * to say. The work dir is named here and nowhere else: it is an instruction to
 * the session, not something the harness is told (PRD 6.4).
 *
 * A long prompt lives in a file in the bot home and the session points at it;
 * a short one is written in the session itself. Either way it is word for word
 * as the user wrote it: it travels as one argument, quoted for the shell it is
 * typed into, so nothing has to be flattened to keep it whole — the two
 * spaces, the newlines and the indentation of a prompt carrying a piece of
 * text or code are the user's, and none of the kit's business.
 */
export function startPrompt(session, { home, workDir }) {
  const note = workDir === undefined
    ? undefined
    : `Your work dir is ${workDir}. It is a plain folder the kit made for you, not a git worktree.`;

  // Only the ends are taken off — a `prompt: |` in YAML, and a file, both carry
  // a newline the user never typed. What is inside is theirs.
  const said = [set(session.prompt_file) ? readFileSync(promptFile(session, home), 'utf8') : session.prompt, note]
    .filter(set)
    .map((part) => String(part).trim());
  return said.length === 0 ? undefined : said.join('\n\n');
}

/** Where a session's prompt file is: in the bot home, where the user put it. */
export const promptFile = (session, home) => path.resolve(home, session.prompt_file);

/**
 * A prompt short and simple enough to type into the launch line as it is: one
 * line, and not a long one. Everything else goes to the harness out of a file,
 * which keeps a page of text out of a tab's shell and its history.
 */
export const isShortPrompt = (prompt) => !prompt.includes('\n') && prompt.length <= SHORT_PROMPT;

const SHORT_PROMPT = 200;

/**
 * The prompt on the launch line: the text itself when it is short, and
 * otherwise the file the kit wrote it to, read back by the shell that types the
 * line. `"$(cat …)"` hands the harness one argument whatever is in the file.
 */
function promptWords(prompt, fromFile) {
  if (fromFile !== undefined) return ['--', `"$(cat ${quoted(fromFile)})"`];
  return prompt === undefined ? [] : ['--', quoted(prompt)];
}

/**
 * The session the harness is told to pick up again, when there is one: a flag
 * on Claude Code, the argument of the `resume` subcommand on Codex.
 */
const resumeWords = (harness, resume) => {
  if (resume === undefined) return [];
  return harness === 'claude' ? ['--resume', quoted(resume)] : [quoted(resume)];
};

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

/**
 * Where the launch line tells the session's hook which shell typed the harness
 * in. One tab holds one session: the harness this shell starts. Anything that
 * session starts inside the tab is not the session and can never be it.
 */
export const SHELL_ENV = 'OBK_TAB_SHELL';

/** A word as a shell needs it. Anything a shell would read as more than a word is quoted. */
const quoted = (word) => (/^[A-Za-z0-9,._+:@%/=-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);

/** The same, for anything else of the kit's that has to build a shell line. */
export const shellWord = quoted;

/**
 * The CLI that is running, by the path it was started by: the kit calls itself
 * back with this, never with the bare name `obk`, because the bare name is
 * whatever PATH says, and PATH is not the kit's to decide (#220). A user's
 * install is started through npm's bin link, and the link is kept rather than
 * resolved, so the path survives an upgrade of the package; a system test that
 * runs a checkout's `src/cli.js` gets that checkout. What an environment
 * variable claims is not asked: the kit says who it is from how it was started.
 */
export const ownCli = () => (process.argv[1] === undefined
  // Nothing started as a script, as with `node -e`: the kit's own entry file.
  ? fileURLToPath(new URL('./cli.js', import.meta.url))
  : path.resolve(process.argv[1]));

/**
 * Where the launch line hands the session the CLI that started it, so a bot's
 * own commands can call the same one. A plain variable, because a harness's
 * shell keeps those where it rearranges PATH (#220).
 */
export const CLI_ENV = 'OBK_CLI';
