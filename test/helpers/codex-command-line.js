// The command line of the Codex in front of a live test's tab, as
// `ps -ww -o command=` prints it, read with Orca's identity arguments told
// apart from the kit's own words (#860). See test/codex-command-line.test.js.
//
// Orca's own `codex` shell function (Orca 1.4.263 to 1.4.272,
// out/shared/shell/launch/agents/codex-shell-function.js) puts these in front
// of the arguments the kit typed, unless an argument opts out: for each of the
// keys below that is set and holds no apostrophe, `-c` and
// `shell_environment_policy.set.<KEY>='<value>'`, each one put first, and then
// possibly `-c` `shell_environment_policy.set.SSH_CONNECTION=''` first of all.
// The kit's `--no-daemon` turns off only Orca's isolation, not these. `ps`
// joins the words with one space and drops the shell's quoting, so a value
// with a space in it is read here up to its closing apostrophe, and the kit's
// words after the pairs are split on white space: a resume line carries no
// prompt, and the words before a fresh start's prompt hold no space.

import path from 'node:path';

/** The keys Orca puts in front as identity, with a value it never leaves empty (CODEX_COMMAND_IDENTITY_ENV_KEYS). */
const IDENTITY_KEYS = ['ORCA_TERMINAL_HANDLE', 'ORCA_PANE_KEY', 'ORCA_WORKTREE_ID', 'ORCA_WORKSPACE_ID', 'ORCA_USER_DATA_PATH'];

/** The SSH marker Orca blanks: always with an empty value. */
const SSH_KEY = 'SSH_CONNECTION';

/** One identity pair at the start of `rest`: `-c`, one space, the setting, and a space or the end after its closing apostrophe. */
const PAIR = /^-c shell_environment_policy\.set\.([A-Z_]+)='([^']*)'(?= |$)/;

/**
 * The words of one ps command line: `{ program, identity, args }`. `program`
 * is the first word; `identity` is Orca's identity pairs in front, in the
 * order shown, each `{ key, value }` with its whole value; `args` is every
 * word after them, split on white space. A pair whose key is not Orca's, is
 * given a second time, or has a value Orca would not send (an empty identity
 * value, an SSH marker that is not empty) ends the pairs, and is the start of
 * `args`.
 */
export function codexCommandOf(line) {
  const text = String(line).trim();
  const space = text.search(/\s/);
  const program = space < 0 ? text : text.slice(0, space);
  let rest = space < 0 ? '' : text.slice(space).replace(/^\s+/, '');
  const identity = [];
  for (;;) {
    const found = PAIR.exec(rest);
    if (found === null) break;
    const [whole, key, value] = found;
    const orcas = key === SSH_KEY ? value === '' : IDENTITY_KEYS.includes(key) && value !== '';
    if (!orcas || identity.some((pair) => pair.key === key)) break;
    identity.push({ key, value });
    rest = rest.slice(whole.length).replace(/^ /, '');
  }
  const args = rest.trim() === '' ? [] : rest.trim().split(/\s+/);
  return { program, identity, args };
}

/** Why `args` do not carry `--no-daemon` once and straight after `--approve-for-me`, or undefined. */
function noDaemonFault(args, said) {
  const count = args.filter((word) => word === '--no-daemon').length;
  if (count !== 1) return `it carries --no-daemon ${count} times, not once, after Orca's identity arguments: ${said}`;
  const approve = args.indexOf('--approve-for-me');
  if (approve < 0 || args[approve + 1] !== '--no-daemon') return `its --no-daemon is not straight after --approve-for-me: ${said}`;
  return undefined;
}

/**
 * Why the ps `line` is not the kit's resume of conversation `id`, or
 * undefined when it is: the program is codex, the first word after Orca's
 * identity arguments is `resume`, `--no-daemon` is there once and straight
 * after `--approve-for-me`, and `id` is the last word.
 */
export function resumeFault(line, id) {
  const said = String(line).trim();
  const { program, args } = codexCommandOf(line);
  if (path.basename(program) !== 'codex') return `the harness is not codex: ${said}`;
  if (args[0] !== 'resume') return `the first word after Orca's identity arguments is not resume, but ${JSON.stringify(args[0])}: ${said}`;
  const daemon = noDaemonFault(args, said);
  if (daemon !== undefined) return daemon;
  if (args.at(-1) !== id) return `the last word is not the book's id ${id}: ${said}`;
  return undefined;
}

/**
 * Why the ps `line` is not the kit's fresh start, or undefined when it is: no
 * word after Orca's identity arguments is `resume`, and `--no-daemon` is
 * there once and straight after `--approve-for-me`.
 */
export function freshStartFault(line) {
  const said = String(line).trim();
  const { args } = codexCommandOf(line);
  if (args.includes('resume')) return `it is a resume: ${said}`;
  return noDaemonFault(args, said);
}
