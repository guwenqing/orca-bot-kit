// A fake `osascript` for the ordinary suite. `OBK_OSASCRIPT` points every
// sandboxed run at it, so `npm test` never reaches the machine's own osascript,
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
// directory as `{ args }` for a test to read.
//
// What it answers is what a test told it, in osascript.json beside the log:
// `{ stdout, stderr, code, delayMs }`. `delayMs` holds the answer back that
// long, which with a long enough wait is an osascript that never answers; each
// answer it gets as far as giving is written to osascript-answered.log, so a
// test can tell a call that was killed from one that ran to its end. With
// nothing told it refuses, the way a Mac that has not given the kit
// Accessibility or Automation does: so an ordinary run hears the reload line
// it has always heard. The words of a refusal are illustrative; the kit is
// meant to read only the exit status and the answer on stdout.

import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

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

/** Long enough that a kit that waits for it has stopped waiting first. */
export const OSASCRIPT_HANG_MS = 30_000;

/** Run as `osascript`: write the call down and answer as told. */
export function runOsascript() {
  const dir = process.env.OBK_FAKE_ORCA_DIR;
  if (dir === undefined) {
    process.stderr.write('fake osascript: OBK_FAKE_ORCA_DIR is not set\n');
    process.exit(70);
  }

  const args = process.argv.slice(2);
  appendFileSync(path.join(dir, 'osascript.log'), `${JSON.stringify({ args })}\n`);

  const [script, app] = args;
  const isFile = (file) => existsSync(file) && statSync(file).isFile();
  if (args.length !== 2 || script.startsWith('-') || !isFile(script) || !app.endsWith('.app')) {
    process.stderr.write(`fake osascript: ${args.join(' ')} is not <script file> <Orca.app path>; the kit asks osascript nothing else\n`);
    process.exit(70);
  }

  let told = OSASCRIPT.refused;
  try {
    told = JSON.parse(readFileSync(path.join(dir, 'osascript.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const answer = () => {
    appendFileSync(path.join(dir, 'osascript-answered.log'), `${JSON.stringify({ args })}\n`);
    process.stdout.write(told.stdout ?? '');
    process.stderr.write(told.stderr ?? '');
    process.exitCode = told.code ?? 0;
  };
  if (told.delayMs > 0) setTimeout(answer, told.delayMs);
  else answer();
}
