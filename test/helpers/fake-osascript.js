// A fake `osascript` for the ordinary suite. helpers/fake-tools.js sends every
// sandboxed run's /usr/bin/osascript to it (OBK_TEST_OSASCRIPT), so `npm test` never reaches the machine's own osascript,
// and through it System Events and the real Orca's menu (#343).
//
// The kit asks it one thing: force-reload the window of one Orca, through
// Orca's own menu item View › Force Reload. It runs
//
//   <osascript> <script file> <Orca.app path>
//
// the script being the kit's own file and the path the `.app` folder of the
// Orca CLI in use. Any other shape (no script file, an inline `-e`, more or
// fewer arguments, a path that is no `.app`, which is what the ordinary
// sandbox's CLI leads to until `orcaApp` lays one out) is refused here with
// exit 70, as the fake ps refuses a call it was never meant to get. Every
// call, refused or not, is written to osascript.log in the fake Orca's
// directory for a test to read as `{ args }`.
//
// It is a shell script, not Node, and writing the call down is the first thing
// it does. The kit gives osascript 5 s, and on a loaded machine a Node process
// can take longer than that to start (#381): a fake in Node was killed before
// it had written anything, and a test read no call where there was one. The
// shell is up in milliseconds, so the log says whether the kit ran osascript,
// and the answer a test told it is given, however busy the machine.
//
// What it answers is what a test told it, in osascript.answer beside the log,
// written by `answerScript`: `{ stdout, stderr, code, delayMs }`. `delayMs`
// holds the answer back that long, which with a long enough wait is an
// osascript that never answers; each answer it gets as far as giving is
// written to osascript-answered.log, so a test can tell a call that was killed
// from one that ran to its end. With nothing told it refuses, the way a Mac
// that has not given the kit Accessibility or Automation does: so an ordinary
// run hears the reload line it has always heard. The words of a refusal are
// illustrative; the kit is meant to read only the exit status and the answer
// on stdout.

/** The answers a test can give the fake, by name. */
export const OSASCRIPT = {
  /** The script ran and clicked Force Reload. */
  reloaded: { stdout: 'reloaded\n', code: 0 },
  /** macOS refused: no Automation or Accessibility for the caller. The default. */
  refused: { stderr: 'execution error: Not authorized to send Apple events to System Events. (-1743)\n', code: 1 },
  /** The script ran, and found no Orca or no menu item to click. */
  notFound: { stdout: 'not found\n', code: 0 },
  /** The script ran and said nothing at all. */
  silent: { stdout: '', code: 0 },
};

/** `text` as one word of the shell, quoted. */
const quoted = (text) => `'${String(text).replaceAll("'", "'\\''")}'`;

/** What a test told the fake, as the shell assignments it reads. */
export function answerScript(told) {
  return [
    `stdout=${quoted(told.stdout ?? '')}`,
    `stderr=${quoted(told.stderr ?? '')}`,
    `code=${Number(told.code ?? 0)}`,
    `delay=${told.delayMs > 0 ? told.delayMs / 1000 : 0}`,
    '',
  ].join('\n');
}

/**
 * The fake osascript, keeping its logs and reading its answer in `dir`.
 *
 * Each log holds one entry per call: the number of arguments on a line, then
 * each argument on a line of its own, which `osascriptCalls` reads back. An
 * argument with a line break in it would be misread; the kit's two are paths.
 */
export function osascriptScript(dir) {
  return [
    '#!/bin/sh',
    `dir=${quoted(dir)}`,
    'note() { log=$1; shift; { printf \'%s\\n\' "$#"; for arg in "$@"; do printf \'%s\\n\' "$arg"; done; } >> "$dir/$log"; }',
    'note osascript.log "$@"',
    '',
    'refuse() {',
    '  printf \'fake osascript: %s is not <script file> <Orca.app path>; the kit asks osascript nothing else\\n\' "$*" >&2',
    '  exit 70',
    '}',
    '[ "$#" -eq 2 ] && [ -f "$1" ] || refuse "$@"',
    'case $1 in -*) refuse "$@" ;; esac',
    'case $2 in *.app) ;; *) refuse "$@" ;; esac',
    '',
    answerScript(OSASCRIPT.refused).trimEnd(),
    'if [ -f "$dir/osascript.answer" ]; then . "$dir/osascript.answer"; fi',
    '',
    '# Killed while it holds the answer back, it ends as a killed one does, and',
    '# takes its sleep with it.',
    'if [ "$delay" != 0 ]; then',
    '  trap \'kill "$!" 2>/dev/null; exit 143\' TERM',
    '  sleep "$delay" > /dev/null 2>&1 &',
    '  wait "$!"',
    '  trap - TERM',
    'fi',
    'note osascript-answered.log "$@"',
    'printf \'%s\' "$stdout"',
    'printf \'%s\' "$stderr" >&2',
    'exit "$code"',
    '',
  ].join('\n');
}

/** The entries of one of the fake's logs, `{ args }` each, oldest first. */
export function osascriptCalls(text) {
  const lines = text.split('\n');
  const calls = [];
  for (let at = 0; at < lines.length - 1;) {
    const count = Number(lines[at]);
    calls.push({ args: lines.slice(at + 1, at + 1 + count) });
    at += 1 + count;
  }
  return calls;
}
