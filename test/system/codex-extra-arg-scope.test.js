// A system test: the extra arguments `obk session add` refuses on a Codex
// session really widen what the session may write, and the kit refuses them
// (#567). Against the real Orca and a real Codex on this machine. Run it alone
// with `npm run test:system -- --yes test/system/codex-extra-arg-scope.test.js`;
// `npm test` cannot, and no CI machine could.
//
// At the kit's default `auto` level Codex runs in its `workspace-write`
// sandbox: it may write in its cwd (the bot's folder), in /tmp, in $TMPDIR, in
// the kit's own `--add-dir` folders, and in whatever else its arguments add
// (tech notes, section 3). `--add-dir <dir>` and
// `-c sandbox_workspace_write.writable_roots=[…]` add a folder. #567 makes the
// session commands refuse both; `obk up` does not judge extra_args, so a
// bot.yaml written by hand still starts a session with them, and this test
// uses that to show what they do.
//
// What it proves, in one throwaway fleet with one Codex bot at `auto`, through
// this checkout's src/cli.js:
//
//   1. The real `obk session add` of a Codex session refuses
//      `--add-dir <A>`, and refuses `-c sandbox_workspace_write.writable_roots=["<B>"]`:
//      each exits 1, its output names `obk permission approval`, and bot.yaml
//      is byte for byte as it was. The same call without those arguments (the
//      control's own session add, step 3) goes through, so the refusal is
//      theirs.
//   2. The session `wide`: added by `obk session add` with no such argument,
//      then given `--add-dir <A>` and
//      `-c sandbox_workspace_write.writable_roots=["<B>"]` in bot.yaml by this
//      test, and started by `obk up`. Its start prompt has it run one shell
//      command that tries to write one file in each of A, B and a third folder
//      C that nothing names. Expected: A and B written, C not. That shows the
//      refused arguments widen the write scope. If Codex no longer honours one
//      of them, the test fails and says which.
//   3. The control, `narrow`: added by `obk session add` with no such argument,
//      started beside `wide`, told the same. Expected: none of A, B, C written.
//
// A, B and C are folders beside the bots folder, `<bots>.scope-a`, `-b` and
// `-c`: outside the bot's folder, the kit's three folders, /tmp and $TMPDIR.
// Each session also writes the exit status of a `/bin/ps` it runs (inside the
// sandbox `ps` does not start, so 0 means no sandbox and the run shows
// nothing) and its own $TMPDIR, which must not hold A, B or C.
//
// Escalation. At `auto`, Codex's automatic reviewer may grant a command that
// asks to leave the sandbox, and a write so granted would show nothing about
// the arguments. The start prompt forbids asking. The test reads each
// session's rollout (found by the conversation id the kit's hook wrote into
// the book) for its own shell commands that asked `sandbox_permissions:
// "require_escalated"`, read as test/system/codex-sandbox-writes.test.js
// reads them (step 4 there): a `response_item` that is a `custom_tool_call`
// whose `exec` script calls `exec_command({ cmd: …, sandbox_permissions: … })`,
// or a `function_call` whose JSON arguments carry `sandbox_permissions`.
// Messages are not read: Codex's own instructions at the start of a rollout
// name `require_escalated` and the writable roots, and are no ask. A command
// in `wide` that asked and names A or B makes the run fail as inconclusive;
// any other is said as a diagnostic, and the files decide. What was written is
// said as a diagnostic before that, so an inconclusive run still shows it.
//
// Where the fleet lives, and why not in the temp folder: the sandbox lets a
// session write anywhere under /tmp and $TMPDIR, so A, B and C there would be
// written whatever the arguments, and the test would show nothing. So the bots
// folder is made under the checkout's own `local-data/`, which .gitignore
// keeps out of git, named `obk-system-…`, where the runner
// (scripts/test-system.js) looks for a run's own folders (#534). Every Codex
// session here is launched with its trust given at launch
// (helpers/codex-trust.js), so no trust key is expected.
//
// The machine it runs on is someone's working machine. So this test: works in
// its own throwaway bots folder; writes down every terminal and workspace Orca
// already had; runs this checkout's `src/cli.js` by its full path, never the
// machine's `obk` (#220); types into no tab at all; closes only its own tabs,
// one by one through the tab guard, and deletes its own workspaces through
// deleteOwnProject (#536), whatever happened, failing on any it could not
// remove; and removes the bots folder and every folder beside it that starts
// with its name (A, B and C among them). `orca terminal close --worktree …
// --all` is never run, and the guard refuses it. No session here runs with
// danger-full-access or --dangerously-bypass-approvals-and-sandbox.
//
// **Nobody answers anything by hand.** Both Codex sessions are given their
// folder's trust at launch, which also bypasses the hooks review, so they
// should ask nothing. This test opens no Claude Code tab, so it has no screen
// to answer through `onlyPlainTrustOf` or `onlyTeachFormOf`, and answers
// none: a question of a harness's own stops the run when the wait runs out,
// printing the screen.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { parse, stringify } from 'yaml';

import test from '../helpers/system.js';
import { cliEntry, repoRoot, shellWord } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { rolloutFilesOf } from '../helpers/codex-rollout.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long the two sessions are given to start and run their one command. */
const WORK_MS = 300000;

const BOT = 'scope-codex';
const WIDE = 'wide';
const NARROW = 'narrow';

/** Every close goes through the guard, which counts it for the check at the end (#246). */
const guard = tabGuard(ORCA);
const { orca } = guard;

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The tabs Orca lists at `home` once it has caught up with what was closed (#187). */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = allTerminals().filter((terminal) => terminal.worktreePath === home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
    await setTimeout(250);
    left = allTerminals().filter((terminal) => terminal.worktreePath === home);
  }
  return left;
}

/** Every workspace Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** The environment of wherever this test was started, without anything that names an Orca tab or the kit's launch line. */
const outsideAnyTab = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !name.startsWith('ORCA_') && name !== 'OBK_CLI' && name !== 'OBK_TAB_SHELL'));

/** Run this checkout's `obk`, by its full path (#217, #220), outside any tab. */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir(), env: outsideAnyTab });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  return done;
}

/** Run `obk ... --json`, which must work, and read its answer; every tab it says it opened is counted as this test's. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return guard.openedByKit(JSON.parse(done.stdout));
  } catch {
    return assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** Remove the bots folder and everything beside it that starts with its name. */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));
  for (const name of await ours()) await rm(path.join(parent, name), { recursive: true, force: true });
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** A file's text once it has some, or undefined while it is not there or empty. */
function textIn(file) {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  return text.trim() === '' ? undefined : text.trim();
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const screen = answer.ok === true ? JSON.stringify(answer.result).slice(0, 2000) : '';
  return `${waitingOn(orca, handle) ?? ''} This test answers nothing a tab asks.\n  orca terminal read --terminal ${handle} --screen\n  ${screen}`;
}

/** The files a session writes in its bot's folder, and the one it tries to write in each of A, B and C. */
const filesOf = (home, folders, session) => ({
  ps: path.join(home, `${session}-ps.txt`),
  tmpdir: path.join(home, `${session}-tmpdir.txt`),
  status: Object.fromEntries(Object.keys(folders).map((key) => [key, path.join(home, `${session}-${key}.txt`)])),
  done: path.join(home, `${session}-done.txt`),
  tried: Object.fromEntries(Object.entries(folders).map(([key, dir]) => [key, path.join(dir, `${session}.txt`)])),
});

/** The one shell command a session runs: the premises, a write into each folder with its status, and the end. */
function commandOf(files) {
  const word = shellWord;
  return [
    `/bin/ps -o pid= -p 1 >/dev/null 2>&1; echo $? > ${word(files.ps)}`,
    `printf '%s' "$TMPDIR" > ${word(files.tmpdir)}`,
    ...Object.keys(files.tried).map((key) => `printf x > ${word(files.tried[key])}; echo $? > ${word(files.status[key])}`),
    `echo done > ${word(files.done)}`,
  ].join('; ');
}

/** A session's start prompt: run the one command, inside the sandbox, and nothing else. */
const promptOf = (files) => [
  'You are a system test\'s bot and you own nothing.',
  'Run exactly this one shell command, once, exactly as written, inside your sandbox, and nothing else.',
  'Never ask for approval, for escalation or for any permission outside your sandbox.',
  'If parts of it fail, do not retry it and do not change it.',
  'Then say nothing and wait.',
  `The command: ${commandOf(files)}`,
].join(' ');

/** A JavaScript string literal in a Codex `exec` script, as its value: double, single or backtick quoted. */
function jsStringAt(text) {
  const quote = text[0];
  if (!['"', "'", '`'].includes(quote)) return undefined;
  let value = '';
  for (let at = 1; at < text.length; at += 1) {
    const char = text[at];
    if (char === quote) return value;
    if (char === '\\') {
      const next = text[at + 1];
      value += { n: '\n', t: '\t', r: '\r' }[next] ?? next;
      at += 1;
    } else {
      value += char;
    }
  }
  return undefined;
}

/**
 * The shell commands of a session's own that asked to leave the sandbox, as
 * their text, oldest first. Only tool calls are read (see the header): a
 * `custom_tool_call` script's `exec_command(` calls that carry
 * `sandbox_permissions: "require_escalated"`, and a `function_call` whose
 * arguments have `sandbox_permissions` `require_escalated`. Nothing else of
 * the rollout is kept.
 */
function escalationsIn(file) {
  const asked = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== 'response_item') continue;
    const item = entry.payload ?? {};
    if (item.type === 'custom_tool_call') {
      for (const call of String(item.input ?? '').split('exec_command(').slice(1)) {
        if (!/sandbox_permissions\s*:\s*["'`]require_escalated/.test(call)) continue;
        const found = /\bcmd\s*:\s*/.exec(call);
        asked.push((found === null ? undefined : jsStringAt(call.slice(found.index + found[0].length))) ?? call.slice(0, 500));
      }
    } else if (item.type === 'function_call') {
      let args = {};
      try {
        args = JSON.parse(item.arguments);
      } catch {
        // an argument list still being written
      }
      if (args?.sandbox_permissions !== 'require_escalated') continue;
      const command = args.cmd ?? args.command ?? '';
      asked.push(Array.isArray(command) ? command.join(' ') : String(command));
    }
  }
  return asked;
}

test('#567 obk session add refuses --add-dir and -c sandbox_workspace_write.writable_roots on a Codex session, and a Codex session started with them writes where they say, where the control writes nowhere', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  // Outside /tmp and $TMPDIR, which the sandbox lets every session write (see the header).
  const parent = path.join(repoRoot, 'local-data');
  const parentWasThere = existsSync(parent);
  await mkdir(parent, { recursive: true });
  const bots = await realpath(await mkdtemp(path.join(parent, 'obk-system-codex-extra-arg-scope-')));
  const homes = ['bot-father', BOT].map((bot) => path.join(bots, 'bots', bot));
  const home = homes[1];
  const folders = { a: `${bots}.scope-a`, b: `${bots}.scope-b`, c: `${bots}.scope-c` };
  const files = { [WIDE]: filesOf(home, folders, WIDE), [NARROW]: filesOf(home, folders, NARROW) };

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(placesOf(homes, allSetups(), bots));
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of projectsInBots(allSetups(), bots)) {
      if (before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    // Orca's sidebar keeps a deleted project's row until its window is rebuilt (#343).
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);
    if (!parentWasThere) await rmdir(parent).catch(() => {});

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  const outside = (dir, tmp) => !`${dir}/`.startsWith(`${tmp.replace(/\/+$/, '')}/`);
  for (const tmp of new Set([os.tmpdir(), await realpath(os.tmpdir()), '/tmp', '/private/tmp'])) {
    for (const dir of [bots, ...Object.values(folders)]) {
      assert.ok(outside(dir, tmp), `the premise: ${dir} is outside ${tmp}, which the sandbox lets every session write`);
    }
  }
  for (const dir of Object.values(folders)) await mkdir(dir);

  // The fleet. No --approval anywhere: every session is at the kit's default, `auto`.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson(['bot', 'create', '--bots', bots, '--name', BOT, '--harness', 'codex', '--charter', `${BOT} exists for one system test run and owns nothing.`]);
  const botYaml = path.join(home, 'bot.yaml');

  // 3, first half. The control, added with no argument that widens it.
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', NARROW, `--prompt=${promptOf(files[NARROW])}`, ...codexTrustArgs(bots)]);

  // 1. The same call, with an argument that widens the write scope, is refused and writes nothing.
  const writableRoots = `sandbox_workspace_write.writable_roots=[${JSON.stringify(folders.b)}]`;
  const yamlBefore = await readFile(botYaml, 'utf8');
  for (const [what, widening] of [
    [`--add-dir ${folders.a}`, ['--extra-arg=--add-dir', `--extra-arg=${folders.a}`]],
    [`-c ${writableRoots}`, ['--extra-arg=-c', `--extra-arg=${writableRoots}`]],
  ]) {
    const refused = obk(['session', 'add', '--bots', bots, '--bot', BOT, '--name', 'probe', `--prompt=${promptOf(files[NARROW])}`, ...widening, ...codexTrustArgs(bots)]);
    const said = `${refused.stdout}${refused.stderr}`;
    t.diagnostic(`session add with ${what}: exit ${refused.status}: ${said.trim()}`);
    assert.equal(refused.status, 1, `obk session add of a Codex session with ${what} should be refused, and exited ${refused.status}: ${said}`);
    assert.ok(said.includes('permission approval'), `the refusal of ${what} should name obk permission approval, got: ${said}`);
    assert.equal(await readFile(botYaml, 'utf8'), yamlBefore, `the refusal of ${what} left bot.yaml as it was`);
  }

  // 2. The wide session: added as the control was, then given the two
  //    arguments in bot.yaml by hand, which `obk up` does not judge.
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', WIDE, `--prompt=${promptOf(files[WIDE])}`, ...codexTrustArgs(bots)]);
  const doc = parse(await readFile(botYaml, 'utf8'));
  doc.sessions = doc.sessions.map((session) => (session.name === WIDE
    ? { ...session, extra_args: [...(session.extra_args ?? []), '--add-dir', folders.a, '-c', writableRoots] }
    : session));
  await writeFile(botYaml, stringify(doc));

  // Both sessions up at once: one turn each.
  const up = obkJson(['up', '--bots', bots, '--bot', BOT]);
  const tabs = {};
  for (const name of [WIDE, NARROW]) {
    const found = (up.tabs ?? []).filter((entry) => entry.name === name);
    assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(up.tabs)}`);
    assert.equal(found[0].created, true, `${name}'s tab was opened: ${JSON.stringify(found[0])}`);
    assert.equal(found[0].harnessStarted, true, `no harness came up in ${found[0].title}: look at it with \`orca terminal read --terminal ${found[0].terminal} --screen\``);
    tabs[name] = found[0];
  }

  const stop = Date.now() + WORK_MS;
  while (![WIDE, NARROW].every((name) => textIn(files[name].done) !== undefined)) {
    const late = [WIDE, NARROW].filter((name) => textIn(files[name].done) === undefined);
    assert.ok(Date.now() < stop, `gave up after ${WORK_MS} ms waiting for ${late.join(' and ')} to run its command.${late.map((name) => whatIsUp(tabs[name].terminal)).join('\n')}`);
    await setTimeout(2000);
  }

  // What was written, and what the sandbox refused, said first, so that a run
  // that ends on a premise or on the escalation check still shows it.
  const written = Object.fromEntries([WIDE, NARROW].map((name) => [
    name,
    Object.fromEntries(Object.keys(folders).map((key) => [key, existsSync(files[name].tried[key])])),
  ]));
  const statuses = Object.fromEntries([WIDE, NARROW].map((name) => [
    name,
    Object.fromEntries(Object.keys(folders).map((key) => [key, textIn(files[name].status[key])])),
  ]));
  for (const name of [WIDE, NARROW]) {
    t.diagnostic(`${name} wrote: ${Object.keys(folders).map((key) => `${key.toUpperCase()} ${written[name][key] ? 'yes' : 'no'} (exit ${statuses[name][key]})`).join(', ')}`);
  }

  // The premises: each ran in its sandbox, and its $TMPDIR holds none of A, B, C.
  for (const name of [WIDE, NARROW]) {
    const ps = textIn(files[name].ps);
    t.diagnostic(`/bin/ps in ${name}'s sandbox exited ${ps}`);
    assert.ok(ps !== undefined, `the premise: ${name} wrote the exit status of /bin/ps to ${files[name].ps}`);
    assert.notEqual(ps, '0', `the premise: /bin/ps does not start in the Codex sandbox; ${name} ran outside one and shows nothing`);
    const sessionTmp = textIn(files[name].tmpdir);
    assert.ok(sessionTmp !== undefined, `the premise: ${name} wrote its $TMPDIR to ${files[name].tmpdir}`);
    const spellings = new Set([sessionTmp, existsSync(sessionTmp) ? await realpath(sessionTmp) : sessionTmp]);
    for (const tmp of spellings) {
      for (const dir of Object.values(folders)) {
        assert.ok(outside(dir, tmp), `the premise: ${dir} is outside ${name}'s $TMPDIR ${tmp}, which its sandbox may write`);
      }
    }
  }

  // Escalation: a granted one would write without the arguments' help.
  const escalations = {};
  for (const name of [WIDE, NARROW]) {
    const id = parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8'))?.sessions?.[name]?.session;
    assert.equal(typeof id, 'string', `the premise: the kit's hook wrote ${name}'s conversation into the book`);
    const rollouts = rolloutFilesOf(path.join(os.homedir(), '.codex', 'sessions'), id);
    assert.equal(rollouts.length, 1, `the premise: one rollout of ${name}'s conversation ${id}, got: ${JSON.stringify(rollouts)}`);
    escalations[name] = escalationsIn(rollouts[0]);
    t.diagnostic(`${name} asked to leave its sandbox ${escalations[name].length} time(s)`);
  }
  const wideAskedFor = escalations[WIDE].filter((text) => text.includes(folders.a) || text.includes(folders.b));
  assert.deepEqual(wideAskedFor.map((text) => text.slice(0, 500)), [], `${WIDE} asked to leave its sandbox for a write into A or B, against its prompt, so its files cannot tell whether the arguments or the reviewer let it write: inconclusive, run it again`);

  // What was written decides.
  const asked = (name) => (escalations[name].length > 0 ? ` (${name} asked to leave its sandbox ${escalations[name].length} time(s); a granted ask may have written it)` : '');
  assert.equal(written[WIDE].a, true, `Codex no longer honours --add-dir: ${WIDE}, started with --add-dir ${folders.a}, could not write ${files[WIDE].tried.a} (exit ${statuses[WIDE].a})`);
  assert.equal(written[WIDE].b, true, `Codex no longer honours -c sandbox_workspace_write.writable_roots: ${WIDE}, started with -c ${writableRoots}, could not write ${files[WIDE].tried.b} (exit ${statuses[WIDE].b})`);
  assert.equal(written[WIDE].c, false, `${WIDE} wrote ${files[WIDE].tried.c}, in a folder no argument names, so its sandbox is wider than those two arguments make it${asked(WIDE)}`);
  for (const key of Object.keys(folders)) {
    assert.equal(written[NARROW][key], false, `the control ${NARROW}, with no argument that widens it, wrote ${files[NARROW].tried[key]}${asked(NARROW)}`);
  }
});
