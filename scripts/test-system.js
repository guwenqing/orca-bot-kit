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
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { parse as parseToml, TomlError } from 'smol-toml';

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
 * (ADR 0035). Orca offers no `run-delete`, and the one reset it
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

/** Codex's own config: CODEX_HOME's, or ~/.codex's (tech notes, section 3). */
const codexConfigFile = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');

/** Claude Code's user-level record, where it keeps a folder's trust: CLAUDE_CONFIG_DIR's, or the home folder's. */
const claudeConfigFile = () => path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json');

/** A config.toml table header naming a folder's trust or a hook's: `[projects."…"]` or `[hooks.state."…"]`. */
const TRUST_HEADER = /^[ \t]*\[(projects|hooks\.state)\.("(?:[^"\\]|\\.)*"|'[^']*')\][ \t]*(?:#.*)?$/;

/** A quoted TOML key, read back to the path it names. */
function tomlKey(quoted) {
  if (quoted.startsWith('\'')) return quoted.slice(1, -1);
  try {
    return JSON.parse(quoted);
  } catch {
    return quoted.slice(1, -1);
  }
}

/**
 * The trust keys in the two harness configs: Codex's `projects` and
 * `hooks.state` table headers, and the keys of Claude Code's `projects`. Only
 * the keys are read out, never a value: these files hold the owner's
 * credentials. A missing file has no keys; one that cannot be read is
 * `undefined`, with why, and why never quotes the file.
 */
function trustKeys() {
  const codex = { file: codexConfigFile() };
  if (existsSync(codex.file)) {
    try {
      // From the parsed document, not from lines that look like headers: a
      // multi-line string can hold such a line (#240 review).
      const doc = parseToml(readFileSync(codex.file, 'utf8'));
      codex.keys = Object.keys(trustTables(doc));
      codex.notices = noticeCounts(doc);
    } catch (error) {
      codex.why = notQuoted(error);
      // Text that is there and does not parse may still hold a run's keys.
      codex.unparsed = error instanceof TomlError;
    }
  } else {
    // No file is a known empty one, not an unread one: a counter Codex makes
    // in a file of its own during the run is still named (#456 review).
    codex.keys = [];
    codex.notices = {};
  }

  const claude = { file: claudeConfigFile() };
  if (existsSync(claude.file)) {
    let record;
    try {
      record = JSON.parse(readFileSync(claude.file, 'utf8'));
    } catch (error) {
      // Not the parser's message: it quotes the text it choked on.
      claude.why = error instanceof SyntaxError ? 'it is not JSON' : (error.code ?? 'it could not be read');
    }
    if (claude.why === undefined) {
      const projects = record?.projects;
      if (projects === undefined) claude.keys = [];
      else if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) claude.why = 'its projects is not an object';
      else claude.keys = Object.keys(projects);
    }
  } else {
    claude.keys = [];
  }

  return { codex, claude };
}

/**
 * The folder of this run's under the temp folder that `key` names, or
 * undefined: a system test makes its bots folder as `<tmp>/obk-system-<name>-…`,
 * and macOS spells the temp folder both with `/private` in front and without.
 */
function runFolderOf(raw) {
  // `..`, `.` and doubled slashes are resolved first, so a key that names the
  // run's folder and then leaves it is not the run's (#240 review).
  const key = path.posix.normalize(raw);
  let real;
  try {
    real = realpathSync(os.tmpdir());
  } catch {
    real = os.tmpdir();
  }
  const bare = real.replace(/^\/private(?=\/)/, '');
  for (const tmp of new Set([real, bare, `/private${bare}`, os.tmpdir()])) {
    if (!key.startsWith(`${tmp}/`)) continue;
    const folder = key.slice(tmp.length + 1).split('/')[0];
    if (folder.startsWith('obk-system-')) return folder;
  }
  return undefined;
}

/** Whether `key` names a place in one of this run's own folders: one that was not there before it (#240). */
function runOwns(key, foldersBefore) {
  const folder = runFolderOf(key);
  return folder !== undefined && !foldersBefore.has(folder);
}

/**
 * The obk-system-* folders under the temp folder right now, by name. Taken
 * before the tests run, so that a folder another session made earlier is not
 * mistaken for this run's: only a folder that appears while the run goes on
 * counts as its own (#240). A second system-test run started on this machine at
 * the same time would still be counted; nothing here can tell the two apart.
 */
function runFoldersNow() {
  try {
    return new Set(readdirSync(os.tmpdir()).filter((name) => name.startsWith('obk-system-')));
  } catch {
    return new Set();
  }
}

/**
 * The system tests whose Codex writes its trust on purpose, by their folders'
 * prefix, and why: codex-first-run-screens answers Codex's trust screens
 * itself (#240), codex-groom-run's grooming session answers its Codex
 * run's first-run screens, as a maker does (#238), temp-of-temp's
 * temporary Claude session answers its Codex session's hooks review (#464),
 * and session-first-run answers a long-lived Codex session's hooks review
 * with obk session trust-hooks (#506).
 */
const KNOWN_WRITERS = [
  { prefix: 'obk-system-codex-screens-', test: 'codex-first-run-screens', does: 'answers Codex\'s trust screens on purpose', issue: '#240' },
  { prefix: 'obk-system-codex-groom-', test: 'codex-groom-run', does: 'has its grooming session answer its Codex run\'s first-run screens', issue: '#238' },
  { prefix: 'obk-system-temp-of-temp-', test: 'temp-of-temp', does: 'has its temporary Claude session answer its Codex session\'s hooks review', issue: '#464' },
  { prefix: 'obk-system-session-first-run-', test: 'session-first-run', does: 'answers a long-lived Codex session\'s hooks review with obk session trust-hooks', issue: '#506' },
];
const writerOf = (key) => KNOWN_WRITERS.find((one) => runFolderOf(key).startsWith(one.prefix));

/**
 * What the run left in the harness configs under its own throwaway folders,
 * taken out again (#240, the owner's (b)): only keys that were not there
 * before the run and that name a folder the run made, from Codex's config and
 * Claude Code's record alike, the known writers' (KNOWN_WRITERS) included.
 * Everything else in both files stays as it was. A Codex key from a test that
 * is not a known writer still fails the run, removed or not: a system test
 * gives Codex its trust at launch (#433). Keys that were there before, and keys
 * outside the run's folders, are not this run's to answer for. Answers whether
 * the run failed on what it left.
 */
function reportConfigsLeft(before, foldersBefore) {
  const after = trustKeys();
  const lines = [];
  const ours = (key) => runOwns(key, foldersBefore);
  const compared = (side) => before[side].keys !== undefined && after[side].keys !== undefined;
  const added = (side) => (compared(side) ? after[side].keys.filter((key) => !before[side].keys.includes(key) && ours(key)) : []);

  for (const side of ['codex', 'claude']) {
    const why = before[side].why ?? after[side].why;
    if (why !== undefined) lines.push(`Could not read ${after[side].file} (${why}), so what the run left there was not compared.`);
  }

  const codex = added('codex');
  const known = codex.filter((key) => writerOf(key) !== undefined);
  const left = codex.filter((key) => !known.includes(key));
  const claude = added('claude');

  // What the run added is taken out again, and only that (#240, the owner's
  // (b)). Each file is read, changed and written straight away, so the window
  // in which a running harness could write it too is as short as it can be.
  const removed = {
    codex: removeKeys(after.codex.file, codex, withoutTables),
    claude: removeKeys(after.claude.file, claude, withoutProjects),
  };
  const gone = (side) => (removed[side].why === undefined
    ? 'They were removed again:'
    : `They could not be removed (${removed[side].why}), so they are the owner's to clear:`);

  if (left.length > 0) {
    lines.push(
      `The run left ${left.length} trust key${left.length === 1 ? '' : 's'} in ${after.codex.file} under its own folders,`,
      `which a system test must not do (#240). ${gone('codex')}`,
      ...left.map((key) => `  ${key}`),
    );
  }
  for (const writer of KNOWN_WRITERS) {
    const its = known.filter((key) => writerOf(key) === writer);
    if (its.length === 0) continue;
    lines.push(
      `${writer.test} ${writer.does}, and wrote its known keys in ${after.codex.file} (${writer.issue}). ${gone('codex')}`,
      ...its.map((key) => `  ${key}`),
    );
  }
  if (claude.length > 0) {
    lines.push(
      `Claude Code recorded ${claude.length === 1 ? 'one of the run\'s folders' : `${claude.length} of the run's folders`} in ${after.claude.file} (#240). ${gone('claude')}`,
      ...claude.map((key) => `  ${key}`),
    );
  }
  // Codex's new-model notice counter is the harness's own write, not a run key:
  // named, by model, and left where it is (#456).
  const counted = before.codex.notices === undefined || after.codex.notices === undefined ? [] : Object.keys(after.codex.notices)
    .filter((model) => !isDeepStrictEqual(after.codex.notices[model], before.codex.notices[model]));
  if (counted.length > 0) {
    lines.push(
      `Codex counted its new-model notice in ${after.codex.file}'s [tui.model_availability_nux], a harness write it makes at most 4 times per model, left as it is (#456):`,
      ...counted.map((model) => `  ${model}`),
    );
  }
  // Nothing added is only a finding for a file that was compared both times.
  if (codex.length === 0 && claude.length === 0) {
    if (compared('codex') && compared('claude')) lines.push('The harness configs gained no keys under the run\'s own folders.');
    else if (compared('codex')) lines.push(`Only ${after.codex.file} was compared: nothing was added there under the run's own folders.`);
    else if (compared('claude')) lines.push(`Only ${after.claude.file} was compared: nothing was added there under the run's own folders.`);
  }

  process.stdout.write(`\n${lines.join('\n')}\n`);
  return left.length > 0 || removed.codex.why !== undefined || removed.claude.why !== undefined
    || after.codex.unparsed === true;
}

/** The projects Orca has, as `project setups` lists them, or undefined when it could not say. */
function listSetups() {
  const setups = askOrca(['project', 'setups'])?.setups;
  return Array.isArray(setups) ? setups : undefined;
}

/**
 * The Orca projects the run left in its own throwaway folders (#536). A system
 * test removes the projects it made in its teardown; one it could not remove
 * stays in the owner's Orca. Each is named by its path and its setup id, and
 * fails the run. None is removed here: what removes a project is the test's
 * own teardown. A project is the run's only when Orca did not have it before
 * the run (`before`, by setup id) and it is in a folder the run made: an
 * earlier run's project whose folder is gone is not this run's (review of PR
 * #546). With no listing from before, new cannot be told from old, and that is
 * said. Answers whether the run failed on what it left.
 */
function reportProjectsLeft(before, foldersBefore) {
  const setups = before === undefined ? undefined : listSetups();
  if (setups === undefined) {
    process.stdout.write('\nOrca did not list its projects, so the kit cannot tell which projects the run left in its own folders.\n');
    return false;
  }
  const had = new Set(before.map((setup) => setup?.id));
  const left = setups.filter((setup) => typeof setup?.path === 'string' && !had.has(setup.id) && runOwns(setup.path, foldersBefore));
  if (left.length === 0) {
    process.stdout.write('\nOrca has no project in the run\'s own folders.\n');
    return false;
  }
  process.stdout.write(`${[
    '',
    `The run left ${left.length} Orca project${left.length === 1 ? '' : 's'} in its own folders, which a system test must not do (#536).`,
    'They were not removed, so they are the owner\'s to remove:',
    ...left.map((setup) => `  ${setup.path}  (setup ${setup.id})`),
  ].join('\n')}\n`);
  return true;
}

/**
 * Take `keys` out of `file` with `without`, a change to its text, and write it
 * back through a temp file beside it and a rename, with the file's own mode.
 * `{}` when that was done or there was nothing to take out; `{ why }`, which
 * never quotes the file, when it could not be.
 */
function removeKeys(file, keys, without) {
  if (keys.length === 0) return {};
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.obk-${process.pid}`);
  try {
    const text = without(readFileSync(file, 'utf8'), new Set(keys));
    writeFileSync(temp, text, { mode: statSync(file).mode & 0o7777 });
    renameSync(temp, file);
    return {};
  } catch (error) {
    try {
      if (existsSync(temp)) rmSync(temp);
    } catch {
      // Left beside the file; said below with the rest.
    }
    return { why: notQuoted(error) };
  }
}

/** Any TOML table header: a table's, or an array of tables'. */
const TABLE_HEADER = /^[ \t]*\[/;

/**
 * Why a file could not be read or changed, in words that never quote it: a
 * parser's own message would.
 */
function notQuoted(error) {
  if (error instanceof SyntaxError) return 'it is not JSON';
  if (error instanceof TomlError) return 'it is not valid TOML';
  return error?.code ?? (error instanceof TrustTablesError ? error.message : 'it could not be read or changed');
}

/** A cleanup that would not leave exactly the document it should, said in the kit's own words. */
class TrustTablesError extends Error {}

/**
 * Codex's count of how often it showed each new-model notice, from a parsed
 * config.toml's `[tui.model_availability_nux]`: model name to count, `{}` when
 * there is none. Codex 0.160.0 writes it at startup while tooltips are on, at
 * most 4 times per model (#456).
 */
function noticeCounts(doc) {
  const table = doc.tui?.model_availability_nux;
  return table !== null && typeof table === 'object' ? Object.fromEntries(Object.entries(table)) : {};
}

/** The trust tables of a parsed config.toml, by key: its `projects` and its `hooks.state` ones. */
function trustTables(doc) {
  return { ...(doc.projects ?? {}), ...(doc.hooks?.state ?? {}) };
}

/**
 * A parsed TOML value as plain data, so two can be compared whatever their
 * prototypes: smol-toml makes its tables with none, and a copy has Object's.
 */
function plain(value) {
  if (value instanceof Date) return { date: value.toISOString() };
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, one]) => [key, plain(one)]));
  return value;
}

/** The parsed document, as plain data, less the trust tables `gone` names, and less a table they leave empty. */
function lessTables(doc, gone) {
  const less = plain(doc);
  for (const key of gone) {
    if (less.projects !== undefined) delete less.projects[key];
    if (less.hooks?.state !== undefined) delete less.hooks.state[key];
  }
  if (less.projects !== undefined && Object.keys(less.projects).length === 0 && Object.keys(doc.projects).length > 0) delete less.projects;
  if (less.hooks?.state !== undefined && Object.keys(less.hooks.state).length === 0 && Object.keys(doc.hooks.state).length > 0) delete less.hooks.state;
  if (less.hooks !== undefined && Object.keys(less.hooks).length === 0 && Object.keys(doc.hooks).length > 0) delete less.hooks;
  return less;
}

/**
 * The lines without the table whose header is at `at`. A table goes from its
 * header to the next table's, less the comment lines right above that header,
 * which are the next table's own. A table that ends the file goes to the end,
 * with the one blank line Codex put above it and no more: a blank line of the
 * owner's own before it stays (live, #240). The file keeps its final newline.
 */
function cutTable(lines, at) {
  let next = at + 1;
  while (next < lines.length && !TABLE_HEADER.test(lines[next])) next += 1;
  if (next < lines.length) {
    let end = next;
    while (end > at + 1 && /^[ \t]*#/.test(lines[end - 1])) end -= 1;
    return [...lines.slice(0, at), ...lines.slice(end)];
  }
  let from = at;
  if (from > 0 && lines[from - 1].trim() === '') from -= 1;
  const finalNewline = lines[lines.length - 1] === '';
  return [...lines.slice(0, from), ...(finalNewline ? [''] : [])];
}

/**
 * config.toml's text without the trust tables `gone` names, and with every
 * other line as it was. The file is parsed first, and each table is cut as
 * lines only when the result parses to exactly the document less that table:
 * a line that only looks like its header, inside a multi-line string, is left
 * where it is. Throws, so that nothing is written, when the file does not
 * parse or any of the tables cannot be taken out that way.
 */
function withoutTables(text, gone) {
  const original = parseToml(text);
  const present = new Set(Object.keys(trustTables(original)));
  const wanted = [...gone].filter((key) => present.has(key));
  let lines = text.split('\n');
  let doc = original;
  // Last first, so a cut never moves a line still to be looked at.
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const header = TRUST_HEADER.exec(lines[at]);
    if (header === null) continue;
    const key = tomlKey(header[2]);
    if (!wanted.includes(key) || !(key in trustTables(doc))) continue;
    const cut = cutTable(lines, at);
    let after;
    try {
      after = parseToml(cut.join('\n'));
    } catch {
      continue;
    }
    if (!isDeepStrictEqual(plain(after), lessTables(doc, [key]))) continue;
    lines = cut;
    doc = after;
  }
  const left = wanted.filter((key) => key in trustTables(doc));
  if (left.length > 0 || !isDeepStrictEqual(plain(doc), lessTables(original, wanted))) {
    throw new TrustTablesError(`${left.length || 'some'} of its run tables could not be taken out as whole tables`);
  }
  return lines.join('\n');
}

/**
 * Claude Code's record without the `projects` keys `gone` names, written in
 * the file's own layout: its indentation, and a final newline if it had one.
 */
function withoutProjects(text, gone) {
  const record = JSON.parse(text);
  for (const key of gone) delete record.projects[key];
  const indent = /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? '';
  return JSON.stringify(record, null, indent) + (text.endsWith('\n') ? '\n' : '');
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
  const configsBefore = trustKeys();
  const foldersBefore = runFoldersNow();
  const setupsBefore = listSetups();

  // OBK_SYSTEM_TESTS is how a system test knows this command started it: loaded
  // any other way, it skips (test/helpers/system.js, #328).
  const result = spawnSync(process.execPath, ['--test', ...files], {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, OBK_SYSTEM_TESTS: '1' },
  });

  // After the tests, whatever they did: a failing run leaves Runs behind just
  // as a passing one does, and the developer is owed the accounting either way.
  reportRunsLeft(before);
  const leftKeys = reportConfigsLeft(configsBefore, foldersBefore);
  const leftProjects = reportProjectsLeft(setupsBefore, foldersBefore);

  // The test runner answers 0 or 1, and a run killed by a signal answers
  // nothing at all. Anything but a clean 0 means the system tests did not pass.
  // The Runs accounting never changes this: it is a report, not a check. A
  // trust key left in the owner's Codex config does: that is a check (#240).
  // So is a project left in the owner's Orca (#536).
  return result.status === 0 && !leftKeys && !leftProjects ? 0 : 1;
}

process.exitCode = run();
