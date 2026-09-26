#!/usr/bin/env node

// The system tests: `npm run test:system -- --yes`. They drive the real `obk`
// against the real Orca on this machine, so no CI runner can run them; that is
// why they are a command of their own and not part of `npm test`.
//
// Orca has to be up for them to mean anything. When it is not, that is a skip
// and not a failure: say so and succeed, rather than report a broken kit.
//
// And nobody drives someone's working machine by accident. These tests make
// Orca projects, open tabs in them, start real harnesses and close the tabs
// they made, on the machine the command was typed on. So the command says what
// it is about to drive before it drives any of it, and then does nothing unless
// it was asked in as many words. A run that was not confirmed did not run the
// tests, and does not answer as though it had.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives in <repo>/scripts/, and the tests are always its own repo's,
// whatever directory the command was called from.
const repo = path.resolve(fileURLToPath(import.meta.url), '../..');
const systemTests = path.join(repo, 'test', 'system');

// The Orca CLI that works for a normal user: `/usr/local/bin/orca` is a
// root-only symlink on this machine (tech notes, section 1). OBK_ORCA overrides
// it, for a machine that keeps Orca somewhere else.
const ORCA = '/Applications/Orca.app/Contents/Resources/bin/orca';

/**
 * Whether Orca is up with its runtime reachable — the only state in which a
 * system test means anything. That the CLI answered is not enough: the
 * root-only symlink prints an error and still exits 0, so the answer counts
 * only when it is the JSON that says a runtime is there.
 */
function orcaIsReady() {
  const asked = spawnSync(process.env.OBK_ORCA || ORCA, ['status', '--json']);
  if (asked.error || asked.status !== 0) return false;

  let status;
  try {
    status = JSON.parse(asked.stdout);
  } catch {
    return false;
  }
  // `null` is valid JSON with nothing to say, and so is anything else that
  // does not carry a runtime that calls itself reachable.
  return status !== null && status.ok === true && status.result?.runtime?.reachable === true;
}

/**
 * One Orca call, and its `result`, or undefined when Orca did not answer with
 * one. Every Orca answer is the same envelope — `{ id, ok, result, _meta }` —
 * and only `ok: true` with a result in it counts. A refusal, a crash, or
 * something that is not JSON all come back the same way here, because the
 * caller does the same thing with all three: says it could not find out.
 */
function askOrca(args) {
  const asked = spawnSync(process.env.OBK_ORCA || ORCA, [...args, '--json'], { encoding: 'utf8' });
  if (asked.error) return undefined;

  let answer;
  try {
    answer = JSON.parse(asked.stdout);
  } catch {
    return undefined;
  }
  return answer !== null && typeof answer === 'object' && answer.ok === true && answer.result
    ? answer.result
    : undefined;
}

/**
 * How many Runs one listing asks for, which is as many as Orca will give: it
 * refuses `--limit 101` outright rather than clamping it (tech notes, section
 * 1). `nextCursor` would page past it, and this does not, on purpose.
 *
 * The newest hundred is enough to answer the only question asked here. Runs
 * come back newest first, so anything made while the tests ran is in that
 * hundred, and the difference between two such listings names exactly the new
 * ones however many older Runs the machine is carrying — there are a hundred on
 * this one already. The limit of it: a single run that made more than a hundred
 * Runs would have only its newest hundred named. A full system-test run makes a
 * handful, and paging for a case that cannot happen is more mechanism than the
 * question needs.
 */
const RUNS_ASKED_FOR = 100;

/**
 * The Runs Orca knows about, newest first, or **undefined when it could not
 * say**. The difference matters more than it looks: an empty list means "there
 * are none", and undefined means "nobody knows", and reporting the second as
 * the first is how a run would quietly claim it left nothing behind.
 */
function listRuns() {
  const result = askOrca(['orchestration', 'run-list', '--limit', String(RUNS_ASKED_FOR)]);
  return result === undefined || !Array.isArray(result.runs) ? undefined : result.runs;
}

/**
 * Whether the two listings between them cover the whole of what happened, or
 * only the newest hundred of it.
 *
 * The window reaches back far enough when the second listing is shorter than
 * the hundred asked for — then it is everything Orca has — or when something in
 * it was already in the first, which means it reaches past the moment the tests
 * began. When every Run in a full listing is new, there may be older new ones
 * behind it that this never saw, and the count is a floor rather than a total.
 */
const windowReachesBack = (before, after) =>
  after.length < RUNS_ASKED_FOR || after.some((run) => before.has(run.id));

/**
 * What appeared in the machine's mailbox while the tests ran, and that nobody
 * can take out again.
 *
 * A Run is how a session is written to, and `obk up` makes one per session
 * (ADR 0018). Orca offers no `run-delete`, and the one reset it
 * does offer would empty the whole machine's mailbox, which the kit never runs
 * and neither does this. So the tests cannot leave the list as they found it,
 * and the honest thing left is to say what appeared.
 *
 * **What appeared is not the same as what the tests made**, and this does not
 * pretend otherwise. The machine is shared: anything else that brought a
 * session up while the tests ran made its Run here too, and the runner has no
 * way to tell one from the other — the tests work in throwaway folders whose
 * names it never learns. So it reports what it observed and leaves the
 * attribution to the reader, rather than telling somebody that the live mailbox
 * of a session they are using belongs to a folder that has gone.
 *
 * `before` is what `listRuns` answered before the tests ran, undefined
 * included: a listing that failed then must not make every Run on the machine
 * look like this run's doing.
 */
function reportRunsLeft(before) {
  const after = before === undefined ? undefined : listRuns();

  if (before === undefined || after === undefined) {
    process.stdout.write(
      '\nOrca did not say which orchestration Runs are on this machine, so the kit\n'
      + 'cannot tell you which ones appeared while the tests ran. The tests\' own\n'
      + 'result above stands; only this accounting is missing.\n',
    );
    return;
  }

  const had = new Set(before.map((run) => run.id));
  const appeared = after.filter((run) => !had.has(run.id));
  const whole = windowReachesBack(had, after);

  // Nothing new needs no caveat: if none of the second listing is new then all
  // of it was in the first, which is the boundary being reached by definition.
  if (appeared.length === 0) {
    process.stdout.write('\nNo new orchestration Runs appeared on this machine while the tests ran.\n');
    return;
  }

  process.stdout.write([
    '',
    whole
      ? `${appeared.length} orchestration Run${appeared.length === 1 ? '' : 's'} appeared on this machine while the tests ran:`
      : `At least ${appeared.length} orchestration Runs appeared on this machine while the tests ran:`,
    ...appeared.map((run) => `  ${run.id}  ${run.objective ?? ''}`.trimEnd()),
    ...(whole ? [] : [
      'That is a floor and not a total: Orca answered with the whole hundred it',
      'will give at once, and none of them was there before, so there may be more',
      'that this listing could not reach back far enough to see.',
    ]),
    'None of them could be removed. Orca offers no way to delete a Run, and its',
    'one reset would empty this whole machine\'s mailbox, which the kit never runs.',
    'Which of them the tests made is not established here: anything else that',
    'brought a session up on this machine while they ran is in this list too.',
    '',
  ].join('\n'));
}

/**
 * The system test files, named one by one. `node --test` with nothing to run
 * goes hunting through the whole tree instead, which would drag the ordinary
 * suite into a run meant for these.
 *
 * Subfolders count. Grouping system tests by feature is the obvious next step,
 * and `npm test` does not match them either, so a file one folder deeper would
 * be run by nobody while both commands still reported success.
 */
function testFiles() {
  if (!existsSync(systemTests)) return [];
  return readdirSync(systemTests, { recursive: true })
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(systemTests, name));
}

/**
 * Which Orca this run would ask, and how it came to be that one. A developer
 * reading a skip needs to know which Orca was asked before they can tell
 * whether the skip is right.
 */
function orcaCli() {
  const named = process.env.OBK_ORCA;
  return named
    ? { path: named, from: 'OBK_ORCA names it' }
    : { path: ORCA, from: 'the built-in default; OBK_ORCA names another' };
}

/** The word that says the developer meant it. */
const CONFIRM = '--yes';

const asked = () => process.argv.slice(2).includes(CONFIRM);

/** The files named on the command line: every argument that is not a flag. */
const named = () => process.argv.slice(2).filter((arg) => !arg.startsWith('-'));

/**
 * The system test files this run is for: all of them when none is named, and
 * otherwise the ones named, as `{ files }`, or `{ refused }` with the first name
 * that is not one of them.
 *
 * A name counts only when two things hold. As written, it is a `*.test.js` path
 * inside `test/system/`. And the file it really leads to, every link followed,
 * is one of the files a run with no names would run, a regular file inside
 * `test/system/` as the file system knows it; that file's own path is what runs.
 * That is the whole point of the check: this command is allowed to drive the
 * machine because what it runs is the repo's own reviewed system tests, and a
 * name must not turn it into a way to run anything else, nor reach one of them
 * from outside the folder (#325, review of PR #326).
 */
function chosen(names) {
  const all = testFiles();
  if (names.length === 0) return { files: all };

  const root = realPath(systemTests);
  const inside = (real) => root !== undefined && real !== undefined && real.startsWith(root + path.sep);
  const byReal = new Map(all.map((file) => [realPath(file), file]).filter(([real]) => inside(real)));

  const folder = `${path.relative(repo, systemTests).split(path.sep).join('/')}/`;
  const files = [];
  for (const name of names) {
    const written = asWritten(name);
    const real = realPath(path.resolve(repo, name));
    const counts = written !== undefined && written.startsWith(folder) && written.endsWith('.test.js') && isFile(real);
    const file = counts ? byReal.get(real) : undefined;
    if (file === undefined) return { refused: name };
    if (!files.includes(file)) files.push(file);
  }
  return { files };
}

/**
 * Where a name sits below the repo root as written, `/`-separated: `..` taken as
 * it stands and no link below the root followed, or undefined when it is not
 * below the root at all. The root is found by where it really is, because it
 * may be reached through a link above it: a temp folder on macOS is both
 * `/var/…` and `/private/var/…`.
 */
function asWritten(name) {
  const parts = path.resolve(repo, name).split(path.sep);
  const root = realPath(repo);
  for (let depth = 1; depth <= parts.length; depth += 1) {
    if (realPath(parts.slice(0, depth).join(path.sep) || path.sep) === root) return parts.slice(depth).join('/');
  }
  return undefined;
}

/** Whether a path is a regular file: a folder named like a test is not one. */
function isFile(target) {
  try {
    return target !== undefined && statSync(target).isFile();
  } catch {
    return false;
  }
}

/** A path as the file system knows it, or undefined when it leads nowhere. */
function realPath(target) {
  try {
    return realpathSync(target);
  } catch {
    return undefined;
  }
}

/**
 * What this run is about to drive, said before it drives any of it: whose
 * machine, which Orca, and which files. Printed whatever happens next, because
 * it is as much use to somebody reading a skip as to somebody about to be
 * driven over.
 */
function announce(cli, files) {
  const lines = [
    `The system tests drive this machine: ${os.userInfo().username}@${os.hostname()}.`,
    `Orca: ${cli.path}  (${cli.from})`,
    files.length === 0
      ? `No system test files: ${systemTests} holds none.`
      : `${files.length} system test file${files.length === 1 ? '' : 's'}:`,
    ...files.map((file) => `  ${path.relative(repo, file)}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * What those files do to the machine, in the words somebody needs before they
 * say yes. It is not a warning to be clicked through: every line of it is
 * something the run leaves on the machine it was typed on.
 */
function whatItDoes() {
  process.stdout.write([
    '',
    'They will, on this machine and in this Orca:',
    '  make Orca projects and open tabs in them,',
    '  start real Claude Code and Codex sessions in those tabs,',
    '  close the tabs they opened, and remove the projects and folders they made,',
    '  and leave one orchestration Run per session behind, which Orca offers no way to delete.',
    'They touch only what they create. Nothing else in your Orca is theirs.',
    '',
    '',
  ].join('\n'));
}

function run() {
  // Before anything else, Orca included: a name that is not one of the system
  // tests is refused whether or not there is an Orca to drive.
  const choice = chosen(named());
  if (choice.refused !== undefined) {
    process.stderr.write(
      `${choice.refused} is not one of this repo's system tests, so nothing was run.\n`
      + `Only the *.test.js files under ${path.relative(repo, systemTests)}/ can be named, such as:\n`
      + `  npm run test:system -- ${CONFIRM} ${path.relative(repo, systemTests)}/<file>.test.js\n`,
    );
    return 1;
  }
  const { files } = choice;
  const cli = orcaCli();

  if (!orcaIsReady()) {
    announce(cli, files);
    process.stdout.write(
      '\nIts runtime is not reachable, so the system tests were skipped and nothing ran.\n'
      + 'Start Orca, or point OBK_ORCA at its CLI, and ask for them again.\n',
    );
    return 0;
  }

  if (files.length === 0) {
    // Nothing to drive is nothing to confirm, so this is not the unconfirmed
    // case below: there is no question to have answered.
    process.stdout.write(`There are no system test files yet: ${systemTests} holds none.\n`);
    return 0;
  }

  announce(cli, files);
  whatItDoes();

  if (!asked()) {
    process.stdout.write(
      `Nothing was driven. The command on its own does not run them.\n`
      + `To run them, having read the above:  npm run test:system -- ${CONFIRM}\n`,
    );
    // Not 0: a run that did not run the system tests must not be mistaken for
    // one that ran them and found nothing wrong.
    return 2;
  }

  // Asked before the tests, so that what they add can be told from what the
  // machine already had.
  const before = listRuns();

  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: repo, stdio: 'inherit' });

  // After the tests, whatever they did: a failing run leaves Runs behind just
  // as a passing one does, and the developer is owed the accounting either way.
  reportRunsLeft(before);

  // The test runner answers 0 or 1, and a run killed by a signal answers
  // nothing at all. Anything but a clean 0 means the system tests did not pass.
  // What the accounting above found never changes this: it is a report, not a
  // check.
  return result.status === 0 ? 0 : 1;
}

process.exitCode = run();
