// A system test: the kit's default permission rules, live, on the real Claude
// Code in the real Orca on this machine (#344, slice A), and a rule the bot's
// charter grants, once the user has said yes to it (#353, slice B); and the
// same two, written in Codex's own form, on the real Codex (#354, slice C).
// Run it alone with
// `npm run test:system -- --yes test/system/permissions.test.js`; `npm test`
// cannot, and no CI machine could.
//
// What it is the live check for, in the issues' words: a new Claude bot, and a
// new Codex bot, in auto mode reads its own mail (`obk message check`, and a
// long message's body file) and sends a reply without a single prompt to the
// user; it runs a default command (its commit, its mail) without a refusal;
// and a command no rule covers still goes to the check (Codex: its sandbox and
// its reviewer). And for #353 and #354: a command the bot's charter grants
// runs without a refusal once the user has said yes to its exact rule through
// `obk permission allow`, as Bot Father runs it after showing the user the
// rule.
//
// The order the kit promises is followed as a user would follow it. Since
// #527, `bot create` writes the kit's default set itself, with nobody asked:
// it answers with the rules it added (`defaults`) and offers nothing to wait
// for, and the bot's `allow` and its own rules file (Claude:
// `.claude/settings.json`; Codex: `.codex/rules/obk.rules`) hold the set at
// once (test/helpers/permissions.js spells it). A Codex bot gets the set
// without the Read rule, since Codex's sandbox reads every file. No order is
// asserted among the defaults, and a SendMessage rule is neither required nor
// forbidden. The bot's charter says it publishes releases without asking,
// which grants `Bash(gh release create:*)`; the file does not hold it until
// the user's yes to it is run, `obk permission allow --rule 'Bash(gh release
// create:*)'` through the same CLI. Then `up` brings the bot up.
//
// The bot is given its whole part in its start prompt, with every command it
// runs spelled as the kit spells it (the CLI and the bots folder taken from the
// rules the kit offered): check its mail, read the long body (Claude with its
// Read tool; Codex, which has no Read tool, with `cat`), ask the road with
// `message to`, reply with the `message send` that answer names, `git add` and
// `git commit -- <file>` a file the test put in its folder, `gh release create
// --help` (its charter's grant; it prints help and creates nothing), and last
// `touch` a file beside the bots folder, which no rule covers.
//
// **Where the evidence comes from.** Nothing here rests on what the model says.
//
//   - What the bot ran and what each call answered: the harness's own record
//     of the conversation the kit's hook wrote into the book. Claude Code's
//     transcript has `tool_use` items and the `tool_result` for each (tech
//     notes, section 2); a refusal comes back with `is_error`. Codex's rollout,
//     `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<stamp>-<id>.jsonl`, has each
//     command as a `response_item` (0.157.1: a `custom_tool_call` named `exec`
//     whose JavaScript input calls `tools.exec_command({cmd: ...})`; older: a
//     `function_call` named `exec_command` with `cmd` in its JSON arguments)
//     and its result under the same `call_id`; a refusal says so in the text
//     (`Script failed`, `Rejected(... policy forbids ...)`, the sandbox's
//     `Operation not permitted`). Every default call must have a result that
//     is not one.
//   - On Codex, that nobody reviewed it either: an allow rule runs its command
//     outside the sandbox with no review (tech notes, section 3). A command
//     that asks to leave the sandbox carries `sandbox_permissions:
//     "require_escalated"`, and the auto reviewer's verdict is a rollout of its
//     own whose `session_meta` has `parent_thread_id` set to the bot's
//     conversation and `thread_source: "guardian_review"`, its last answer JSON
//     with `outcome`. So a default call went through with no review when its
//     result is no refusal and it did not ask to escalate, or no such review
//     names it. The long body's `cat` needs no rule at all, since the sandbox
//     reads every file; it is held to the same no-review line.
//   - That it was the rule that let a default call through: the call as it was
//     run matches a rule in the bot's own `.claude/settings.json`, which holds
//     exactly the kit's default set, then the charter's rule the user
//     allowed. Where a rule in
//     another settings file covers it too (the user settings on the machine
//     this was written on allow `Bash(git:*)`), that is said as a diagnostic: the kit's rule was there,
//     and it was not the only one. The charter's grant is #353's whole
//     claim, so for it an allow rule in any other file that covers the call
//     makes the run inconclusive, and it fails saying so, with the file and
//     the rule. That is why the grant is `gh release create`: the user
//     settings on this machine allow `Bash(gh pr:*)` and `Bash(gh issue:*)`,
//     which would cover a pull request or issue grant. On Codex the files are
//     every `.rules` file in `~/.codex/rules`, in `<bots>/.codex/rules` and in
//     `<bot home>/.codex/rules`, and `codex execpolicy check --rules
//     <file> -- <words>`, which only evaluates rules, says which rule of a file
//     matches a call. This machine's `~/.codex/rules/default.rules` allows
//     `git add` and `git commit` (a diagnostic) and holds no `gh release` rule
//     (read in the file when this was written).
//   - No prompt to the user: the bot's screen is read every two or three
//     seconds for the whole of the default calls, and a question of the
//     harness's own on it (a numbered choice with the pointer on it,
//     helpers/screens.js), or Orca naming `agent-approval-prompt`, fails the
//     test with the screen and the call still waiting. A prompt nobody answers
//     also stops the bot, so a run with one cannot get to the end either. That
//     Claude Code 2.1.283's permission question is such a numbered list is
//     not captured in this repo: it is what every question of the harnesses'
//     own seen so far looks like but the trust list (tech notes, section 1).
//   - The mail read: the words the two messages carry, which the bot was never
//     told, in the output of its own `message check` and its own Read of the
//     body file; and Orca's mailbox, which holds both messages as read.
//   - The reply: Orca's mailbox for the session it went to holds one message,
//     with both words in it. The long one's word reached the bot only in the
//     file.
//   - The commit: git's own log in the bots repo holds the file, under a
//     message carrying the long one's word, and the file is clean.
//
// **A command no rule covers still goes to the check.** In auto mode an
// uncovered command may simply be allowed, so "it ran" shows nothing either
// way. Claude Code's docs give the order a call is decided in (permission
// modes page): a matching allow, ask or deny rule first; then read-only calls
// and edits inside the working folder; then the classifier, which may refuse,
// and Claude is told why. So the test shows the first two did not decide it:
// no allow, ask or deny rule in any settings file Claude Code reads for this
// bot matches the command as the bot ran it (the user's, the bot folder's, the
// bots repo root's, and the managed file where there is one), and `touch` on a
// file outside the bot's folder is neither read-only nor an edit inside it. An
// ask or deny rule that matches makes the run inconclusive, and it fails
// saying so, with the file and the rule. What the check then did is written
// down as it happened: it ran (the file is there),
// it was refused (an error result, and no file), or the user was asked. That
// the classifier and not something else made the call is what the docs say
// comes next; nothing a test can read names the classifier.
//
// On Codex the kit's `auto` is a `workspace-write` sandbox with the auto
// reviewer (`--approve-for-me`). With no rule matching (none allows, prompts
// or forbids it, in any rules file Codex reads for this bot), the `touch` is
// stopped by the sandbox, and the bot is told to ask once to leave it; that
// ask goes to the reviewer, whose verdict is read from its own rollout. What
// happened is written down: the sandbox stopped it and no escalation was asked,
// the reviewer allowed or denied it, or the user was asked. The run fails when
// the command ran inside the sandbox (it may not write there, so the sandbox
// settings below did not hold) or left the sandbox with no review.
//
// **The Codex bot's own sandbox settings.** The throwaway bots folder lives
// under `$TMPDIR`, and Codex's sandbox writes `/tmp` and `$TMPDIR` by default,
// so there it would let the bot write the bots repo's `.git` and the file
// beside the bots folder with no rule at all, where a real bots folder would
// not. So the Codex bot's session, and only this test's own session, gets
// `--extra-arg=-c --extra-arg=sandbox_workspace_write.exclude_tmpdir_env_var=true`
// and the same for `sandbox_workspace_write.exclude_slash_tmp=true`. The
// product's launch line is unchanged.
//
// **Made to grow.** #353 turned charter grants into rules and #354 writes the
// same rules for Codex bots; both need this same check. So a harness is one
// entry in HARNESSES (how its rules are written and read, how its calls are
// read back, what its own questions look like, and the rule its charter grant
// becomes), and a rule is one entry in `coveredFor` (the step the bot is
// given, and how its call is known). HARNESSES holds Claude and Codex;
// `coveredFor` holds the default set and the charter's grant, and takes the
// step that reads the long body from the harness.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the others beside it:
//
//   - works in a throwaway bots folder under the system temp directory, made
//     with the prefix `obk-system-permissions-`;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path,
//     and types into no tab at all: the only lines typed are the kit's own;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces and folders, whatever happened, and checks
//     afterwards that it closed no tab it did not create;
//   - reads the user's own Claude settings and Codex rules and never writes
//     them; `codex execpolicy check` only evaluates a rules file.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// It leaves behind what every system test does: the Run mailboxes Orca cannot
// delete, offline entries in Claude Code's Remote Control list, the bot's
// transcript under `~/.claude/projects/`, and the Codex bot's rollouts and its
// reviewer's under `~/.codex/sessions/`. Its Codex sessions are given their
// folder's trust at launch (#240, test/helpers/codex-trust.js), so Codex no
// longer saves trust for the throwaway folder or its hooks in the user's own
// `~/.codex/config.toml`.
//
// **It is attended.** It runs once per harness, Claude first. Answer only
// these, in the order they come:
//
//   1. `Bot Father daily`: Claude Code's folder trust. Leave it; nothing here
//      needs Bot Father.
//   2. `Pen Pal daily` (Codex): it should ask nothing, its trust given at
//      launch (#240); leave it on whatever it shows. Its mailbox is made
//      before its harness starts, and the reply only has to reach that.
//   3. In the Claude run, `Perm Claude daily`: Claude Code's folder trust. Its
//      selection starts on `No, exit`, so it takes a down-arrow and then
//      return. If Claude Code then offers `Teach auto mode about your
//      environment?`, answer `2`, "Not now".
//   4. In the Codex run, `Perm Codex daily` asks no folder trust and no hooks
//      review: both are given at launch (#240). If Codex offers an update,
//      accept it: `1`, "Update now" (the owner's standing decision, #69; tech
//      notes, first-run screens).
//   5. **Nothing else.** A permission question in `Perm Claude daily` or
//      `Perm Codex daily` is what this test is looking for: leave it on the
//      screen, and the test fails and shows it.
//
// Each run takes three to six minutes when the first-run screens are answered
// at once: three tabs, one bot's short run of commands, and a look at the
// mailbox.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { assertSameRules, codexDefaultLines, codexDefaultRules, defaultRules, isSendMessage } from '../helpers/permissions.js';
import { questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';

/**
 * Remove the throwaway bots folder and everything the kit or the bot made
 * beside it: `<bots>.prompts`, `<bots>.messages` where the long body goes, and
 * the file the bot's uncovered command touches are siblings of the bots
 * folder, not children of it (PRD 6.3).
 */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));

  for (const name of await ours()) {
    await rm(path.join(parent, name), { recursive: true, force: true });
  }
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long a tab is given to get past the screens of its own, a person answering them included. */
const READY_MS = 180000;

/** How long the launch line's mailbox step is given to write the session's Run into the book. */
const MAILBOX_MS = 60000;

/** How long the bot is given for all of its covered calls: two reads, a road, a reply, a commit and the charter's release help. */
const DEFAULTS_MS = 480000;

/** How long the bot is given for the one uncovered command, after the rest. */
const UNCOVERED_MS = 240000;

/** How long Orca's inbox is given to list a message the bot's own send already answered for. */
const INBOX_MS = 30000;

/** How long a Codex bot is given, after the sandbox stopped the uncovered command, to ask to leave the sandbox. */
const ESCALATION_MS = 60000;

/** When this file began: a Codex rollout this test's bot or its reviewer wrote is no older. */
const STARTED = Date.now();

/**
 * Ask Orca something and read its JSON. Never the blanket close, on any road.
 * Every tab it closes is counted as this test's, for the check at the end (#246).
 */
const guard = tabGuard(ORCA);
const { orca } = guard;

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/**
 * The tabs Orca lists at `home` once it has caught up with what was closed:
 * `terminal close` answers ok before `terminal list` stops reporting the tab.
 */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

/** Every workspace Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/**
 * Run this checkout's `obk`, by its full path. The `obk` on PATH is the
 * published release this machine uses, not the code under test (#217).
 */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  // The owner reads this output. Orca's word for a workspace must not be in it.
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return guard.openedByKit(JSON.parse(done.stdout));
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/**
 * The default rules a run added to `bot`'s allow, from an answer's
 * `permissions` (#527): its one entry (a bot on one harness has one), which
 * offers no waiting list of the defaults.
 */
function addedTo(answer, bot) {
  assert.ok(Array.isArray(answer.permissions), `the answer should carry a permissions list, got: ${JSON.stringify(answer)}`);
  const found = answer.permissions.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one permissions entry should be about ${bot}, got: ${JSON.stringify(answer.permissions)}`);
  const [entry] = found;
  assert.ok(entry.waiting === undefined || (Array.isArray(entry.waiting) && entry.waiting.length === 0), `nothing should wait for a yes, got: ${JSON.stringify(entry)}`);
  assert.ok(Array.isArray(entry.defaults), `the entry should carry defaults, a list, got: ${JSON.stringify(entry)}`);
  return entry.defaults;
}

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/** The book, read at once: what the calls of a conversation are read by, inside a wait's message too. */
const bookIn = (home) => parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};

/** What the bot's `bot.yaml` says the user allowed: missing means none. */
async function allowedIn(home) {
  const bot = parse(await readFile(path.join(home, 'bot.yaml'), 'utf8')) ?? {};
  return bot.allow ?? [];
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out. `note` is added to the message when it does, so a run left alone
 * says which screen was waiting rather than only that it waited.
 */
async function until(what, within, look, note = () => '') {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** Everything the tab is rendering right now, as one piece of text to look through. */
function screenOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  return answer.ok === true ? JSON.stringify(answer.result) : '';
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; see its header for what the person running it answers.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/**
 * The question of the harness's own on the tab's screen right now, as its rows,
 * or undefined when there is none or the screen cannot be read. `ours` names
 * the first-run questions the person running the test answers, which are not
 * about a permission.
 */
function questionShown(handle, ours) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  if (shown?.source !== 'screen' || !Array.isArray(shown.tail)) return undefined;
  const question = questionOn(shown.tail);
  return question === undefined || ours(question) ? undefined : question;
}

/**
 * Fail at once when the tab is asking the user anything: a question of the
 * harness's own on its screen, or Orca naming an approval prompt it heard of
 * from the harness's hooks (tech notes, section 1). `waiting` names the call
 * the harness is holding, for the message.
 */
function assertNothingAsked(handle, harness, waiting) {
  const question = questionShown(handle, harness.ownQuestion);
  assert.equal(
    question,
    undefined,
    `${harness.name} asked the user something while the bot made its default calls, the call waiting being ${waiting}:\n    ${(question ?? []).join('\n    ')}`,
  );
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '1000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  assert.notEqual(
    blocked,
    'agent-approval-prompt',
    `Orca says ${harness.name} is waiting on an approval prompt, the call waiting being ${waiting}.${whatIsUp(handle)}`,
  );
}

/** How many of the newest messages on the machine the inbox is asked for: far more than this test sends. */
const INBOX_LIMIT = 100;

/**
 * Orca's inbox entries for this test's own Runs, by name: `orca orchestration
 * inbox`, a read of Orca's store that takes nothing out of any mailbox. A live
 * run is started from an Orca tab, and from there `obk message check` refuses
 * any session but the tab's own, `--peek` included (#317), so this is the look
 * that is left (codex-nudge.test.js, #298, where it was first used). It lists
 * every recipient's mail on the machine, so everything but the entries of the
 * Runs named here is dropped before anything can print it.
 */
function inboxOf(runs) {
  const asked = `orca orchestration inbox --json --limit ${INBOX_LIMIT}`;
  // Not through `orca()`, whose failures print Orca's output: here that output
  // is everybody's mail.
  const done = spawnSync(ORCA, ['orchestration', 'inbox', '--json', '--limit', String(INBOX_LIMIT)], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.code}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`${asked} exited ${done.status} and did not answer JSON (${done.stdout.length} characters on stdout, ${done.stderr.length} on stderr; not shown, as they may hold other people's mail)`);
  }
  assert.equal(
    answer?.ok,
    true,
    `${asked} was refused: error code ${JSON.stringify(answer?.error?.code ?? null)} (Orca's message is not shown, as it may quote other people's mail)`,
  );
  const all = answer.result?.messages;
  assert.ok(Array.isArray(all), `the inbox should answer a list of messages, and answered ${all === undefined ? 'none' : typeof all}`);
  const ours = {};
  for (const [name, run] of Object.entries(runs)) {
    ours[name] = all
      .filter((message) => message?.run_id === run)
      .map(({ run_id: runId, read, sequence, subject, body }) => ({ runId, read, sequence, subject, body }));
  }
  return ours;
}

/** A pattern with `*` in it, as a regular expression over the whole text, `*` standing for `star`. */
const glob = (pattern, star) => new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join(star)}$`, 's');

/** A path pattern: `**` for anything, `*` for anything within one folder. */
const pathGlob = (pattern) => new RegExp(
  `^${pattern.split('**').map((part) => glob(part, '[^/]*').source.slice(1, -1)).join('.*')}$`,
  's',
);

/**
 * Whether a Claude Code allow rule lets `call` through, read as its docs give
 * rules (permissions page): `Bash` alone or `Bash(*)` for every command,
 * `Bash(<prefix>:*)` for a command that starts with the prefix, `*` elsewhere
 * as a wildcard; `Read(//<path>)` for an absolute path and `Read(~/<path>)`
 * for one under the home folder, `**` crossing folders. It errs towards
 * "covers": a prefix is not held to a word boundary. Other path forms (relative
 * to a settings file) are not read here and count as not covering.
 */
function claudeRuleCovers(rule, call) {
  const found = /^(\w+)(?:\((.*)\))?$/s.exec(rule);
  if (found === null) return false;
  const [, tool, pattern] = found;
  const everything = pattern === undefined || pattern === '' || pattern === '*';

  if (call.kind === 'command') {
    if (tool !== 'Bash') return false;
    if (everything) return true;
    return glob(pattern.endsWith(':*') ? `${pattern.slice(0, -2)}*` : pattern, '.*').test(call.text);
  }
  if (call.kind === 'read') {
    if (tool !== 'Read') return false;
    if (everything) return true;
    const absolute = pattern.startsWith('//')
      ? pattern.slice(1)
      : pattern.startsWith('~/') ? path.join(os.homedir(), pattern.slice(2)) : undefined;
    return absolute !== undefined && pathGlob(absolute).test(call.text);
  }
  return false;
}

/**
 * The rules of one Claude settings file, by what they do: `{ allow, ask, deny }`,
 * each the file's `permissions.<kind>` list. Every one is an empty list when
 * there is no file (nothing at the path, or a path through a file), when the
 * file is empty, or when it has no such list; the shape is the same either way.
 */
function claudeRulesIn(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    text = '';
  }
  let settings;
  try {
    settings = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    assert.fail(`${file} is not JSON, so this test cannot say what rules it holds`);
  }
  const rules = {};
  for (const kind of RULE_KINDS) {
    rules[kind] = settings?.permissions?.[kind] ?? [];
    assert.ok(Array.isArray(rules[kind]), `${file}'s permissions.${kind} should be a list, got: ${JSON.stringify(rules[kind])}`);
  }
  return rules;
}

/** The `permissions.allow` list of one Claude settings file: an empty list for no file. */
const claudeAllowIn = (file) => claudeRulesIn(file).allow;

/** What a rule can do to a call, as Claude Code's settings name the lists: let it through, ask the user, or refuse it. */
const RULE_KINDS = ['allow', 'ask', 'deny'];

/** The text of a tool result's content, which is a string or a list of text blocks. */
const textOf = (content) => (typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.map((item) => (typeof item === 'string' ? item : item?.text ?? '')).join('\n') : '');

/**
 * The calls a Claude Code conversation made, oldest first, each with its
 * result once the transcript has one: `{ kind, text, result: { error, output } }`,
 * where a Bash call is `kind: 'command'` with the command as written, and a
 * Read is `kind: 'read'` with its path. Read from the harness's own record,
 * `~/.claude/projects/<the folder, every other character a dash>/<id>.jsonl`
 * (tech notes, section 2). A line still being written is left for the next look.
 */
function claudeCalls(home, id) {
  const file = path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  if (!existsSync(file)) return [];
  const uses = new Map();
  const results = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (entry.type === 'assistant' && item?.type === 'tool_use' && !uses.has(item.id)) uses.set(item.id, item);
      if (entry.type === 'user' && item?.type === 'tool_result') {
        results.set(item.tool_use_id, { error: item.is_error === true, output: textOf(item.content) });
      }
    }
  }
  return [...uses.values()].map((use) => ({
    ...(use.name === 'Bash'
      ? { kind: 'command', text: String(use.input?.command ?? '') }
      : use.name === 'Read'
        ? { kind: 'read', text: String(use.input?.file_path ?? '') }
        : { kind: 'other', text: `${use.name} ${JSON.stringify(use.input ?? {})}` }),
    result: results.get(use.id),
  }));
}

/**
 * The rules of one Claude settings file that cover `call`, by what they do:
 * `{ allow, ask, deny }`, each a list of the rules as the file spells them.
 */
function claudeCovering(file, call) {
  const rules = claudeRulesIn(file);
  return Object.fromEntries(RULE_KINDS.map((kind) => [kind, rules[kind].filter((rule) => claudeRuleCovers(rule, call))]));
}

/**
 * The words of a command or a rule as a shell reads plain words: a space ends
 * a word, single and double quotes keep one and come off, and a backslash
 * stands for the character after it (the kit's `'\''` is an apostrophe).
 * Undefined for a quote that does not close. Enough for the commands and rules
 * this test spells; it expands nothing.
 */
function shellWords(text) {
  const words = [];
  let word;
  for (let at = 0; at < text.length;) {
    const char = text[at];
    if (/\s/.test(char)) {
      if (word !== undefined) words.push(word);
      word = undefined;
      at += 1;
    } else if (char === "'" || char === '"') {
      const end = text.indexOf(char, at + 1);
      if (end < 0) return undefined;
      word = (word ?? '') + text.slice(at + 1, end);
      at = end + 1;
    } else if (char === '\\' && at + 1 < text.length) {
      word = (word ?? '') + text[at + 1];
      at += 2;
    } else {
      word = (word ?? '') + char;
      at += 1;
    }
  }
  if (word !== undefined) words.push(word);
  return words;
}

/**
 * The line the kit writes into a Codex bot's obk.rules for one allowed Claude
 * rule, as #354 gives it: `Bash(<words>:*)` or `Bash(<words> *)` becomes
 * `prefix_rule(pattern=[<words>], decision="allow")`, each word a JSON string.
 * Only the Bash rules this test allows are read here.
 */
function codexLineOf(rule) {
  const found = /^Bash\((.+?)(?::\*| \*)\)$/s.exec(rule);
  assert.ok(found !== null, `this test only allows prefix Bash rules on Codex, and was given ${rule}`);
  const words = shellWords(found[1]);
  assert.ok(words !== undefined, `the words of ${rule} do not close their quotes`);
  return `prefix_rule(pattern=[${words.map((word) => JSON.stringify(word)).join(', ')}], decision="allow")`;
}

/** The lines a Codex bot's obk.rules should hold for the rules `allow` holds: no Read rule, no SendMessage rule, and none twice. */
const codexLinesFor = (rules) => [...new Set(rules.filter((rule) => !rule.startsWith('Read(') && !isSendMessage(rule)).map(codexLineOf))];

/** The rule lines of a Codex rules file, in its order, without blank lines and `#` comments: an empty list for no file. */
function codexLinesIn(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    return [];
  }
  return text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
}

/** Every `.rules` file in `dir`, by name: none when there is no such folder. */
function rulesFilesIn(dir) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.rules')).sort().map((name) => path.join(dir, name));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
}

/** What a Codex rule decides, by the names this test gives Claude Code's lists. */
const CODEX_KINDS = { allow: 'allow', prompt: 'ask', forbidden: 'deny' };

/**
 * The rules of one Codex rules file that match `call`, by what they do:
 * `{ allow, ask, deny }`. Codex itself says, through `codex execpolicy check
 * --rules <file> -- <words>`, which only evaluates the file: it answers
 * `{ matchedRules, decision }`, or `{ matchedRules: [] }` for no match.
 */
function codexCovering(file, call) {
  const found = Object.fromEntries(RULE_KINDS.map((kind) => [kind, []]));
  if (call.kind !== 'command' || !existsSync(file)) return found;
  const words = shellWords(call.text) ?? call.text.split(/\s+/).filter((word) => word !== '');
  const done = spawnSync('codex', ['execpolicy', 'check', '--rules', file, '--', ...words], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run codex execpolicy check: ${done.error?.message}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`codex execpolicy check --rules ${file} did not answer JSON (exit ${done.status}): ${done.stdout}${done.stderr}`);
  }
  for (const rule of answer?.matchedRules ?? []) {
    const said = JSON.stringify(rule);
    const decision = /"decision":"(\w+)"/.exec(said)?.[1] ?? answer.decision;
    const kind = CODEX_KINDS[decision];
    assert.ok(kind !== undefined, `codex execpolicy check answered a decision this test does not know, ${decision}: ${done.stdout}`);
    found[kind].push(said);
  }
  return found;
}

/**
 * The folders of Codex's own record a rollout begun during this test can be
 * in: `~/.codex/sessions/<yyyy>/<mm>/<dd>`, from the day before it began to
 * the day after now, by local and by UTC date.
 */
function rolloutDays() {
  const days = new Set();
  for (let at = STARTED - 86400000; at <= Date.now() + 86400000; at += 86400000) {
    const day = new Date(at);
    for (const [year, month, date] of [
      [day.getFullYear(), day.getMonth() + 1, day.getDate()],
      [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()],
    ]) {
      days.add(path.join(os.homedir(), '.codex', 'sessions', String(year), String(month).padStart(2, '0'), String(date).padStart(2, '0')));
    }
  }
  return [...days];
}

/** Every rollout written to since this test began, by its path. */
function rolloutsSince() {
  return rolloutDays()
    .flatMap((dir) => {
      try {
        return readdirSync(dir).filter((name) => name.startsWith('rollout-') && name.endsWith('.jsonl')).map((name) => path.join(dir, name));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    })
    .filter((file) => {
      try {
        return statSync(file).mtimeMs >= STARTED;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    });
}

/** The first line of a file, read without reading the rest: a rollout's `session_meta`. */
function firstLineOf(file) {
  const fd = openSync(file, 'r');
  try {
    const chunks = [];
    const buffer = Buffer.alloc(65536);
    for (let read = 0, total = 0; total < 8 * 1024 * 1024; total += read) {
      read = readSync(fd, buffer, 0, buffer.length, total);
      if (read === 0) break;
      const end = buffer.subarray(0, read).indexOf(0x0a);
      chunks.push(Buffer.from(buffer.subarray(0, end < 0 ? read : end)));
      if (end >= 0) break;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** Every JSON line of a rollout that parses, in order; a line still being written is left for the next look. */
function rolloutLines(file) {
  const lines = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      lines.push(JSON.parse(line));
    } catch {
      // not a whole line yet
    }
  }
  return lines;
}

/** The text of a Codex tool result: a string, a list of `{ type, text }`, or an object holding either. */
const codexTextOf = (output) => (typeof output === 'string'
  ? output
  : Array.isArray(output)
    ? output.map((item) => (typeof item === 'string' ? item : item?.text ?? '')).join('\n')
    : output !== null && typeof output === 'object' ? codexTextOf(output.content ?? output.output ?? '') : '');

/** What a refusal says in a Codex result: a rule forbidding it, a script that failed, or the sandbox stopping it. */
const CODEX_REFUSED = /Script failed|Rejected\(|policy forbids|Operation not permitted/i;

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
 * The commands of one Codex 0.157.1 `exec` script, in order: each
 * `tools.exec_command({ cmd: ... })` in it, and whether that call asked to
 * leave the sandbox (`sandbox_permissions: "require_escalated"`).
 */
function commandsOfScript(input) {
  return String(input).split('exec_command(').slice(1).flatMap((call) => {
    const found = /\bcmd\s*:\s*/.exec(call);
    const text = found === null ? undefined : jsStringAt(call.slice(found.index + found[0].length));
    return text === undefined ? [] : [{ text, escalated: /sandbox_permissions\s*:\s*["'`]require_escalated/.test(call) }];
  });
}

/**
 * The commands a Codex conversation made, oldest first, each with its result
 * once the rollout has one: `{ kind: 'command', text, escalated, result: {
 * error, output } }`. Read from the conversation's rollout, both the 0.157.1
 * form and the older one (tech notes, section 3).
 */
function codexCalls(file) {
  const uses = [];
  const results = new Map();
  for (const entry of rolloutLines(file)) {
    if (entry?.type !== 'response_item') continue;
    const item = entry.payload ?? {};
    if (item.type === 'custom_tool_call' && item.name === 'exec') {
      for (const command of commandsOfScript(item.input)) uses.push({ id: item.call_id, ...command });
    } else if (item.type === 'function_call' && item.name === 'exec_command') {
      let args = {};
      try {
        args = JSON.parse(item.arguments);
      } catch {
        // an argument list still being written
      }
      const text = Array.isArray(args.cmd) ? args.cmd.join(' ') : String(args.cmd ?? '');
      uses.push({ id: item.call_id, text, escalated: args.sandbox_permissions === 'require_escalated' });
    } else if (item.type === 'custom_tool_call_output' || item.type === 'function_call_output') {
      const output = codexTextOf(item.output);
      results.set(item.call_id, { error: CODEX_REFUSED.test(output), output });
    }
  }
  return uses.map(({ id, ...use }) => ({ kind: 'command', ...use, result: results.get(id) }));
}

/** The rollout of a Codex conversation, by its id in the file's name, or undefined while there is none. */
function rolloutOf(id) {
  for (const dir of rolloutDays()) {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const name = names.find((one) => one.startsWith('rollout-') && one.endsWith(`-${id}.jsonl`));
    if (name !== undefined) return path.join(dir, name);
  }
  return undefined;
}

/**
 * The auto reviewer's verdicts on a Codex conversation, each a rollout of its
 * own: `session_meta` with `parent_thread_id` the conversation's id and
 * `thread_source: "guardian_review"`. Each as `{ file, text, outcome }`: every
 * text the review was given or said, and the `outcome` of its last answer.
 * Only rollouts written since this test began are looked at, and only their
 * first line unless it is a review of this conversation.
 */
function guardianReviews(id) {
  const reviews = [];
  for (const file of rolloutsSince()) {
    let meta;
    try {
      meta = JSON.parse(firstLineOf(file));
    } catch {
      continue;
    }
    if (meta?.payload?.parent_thread_id !== id || meta.payload.thread_source !== 'guardian_review') continue;
    const texts = [];
    let outcome;
    for (const entry of rolloutLines(file)) {
      const item = entry?.payload ?? {};
      const said = entry?.type === 'response_item' && item.type === 'message'
        ? codexTextOf(item.content)
        : entry?.type === 'event_msg' && item.type === 'agent_message' ? String(item.message ?? '') : '';
      if (said === '') continue;
      texts.push(said);
      if (item.role === 'assistant' || item.type === 'agent_message') {
        try {
          outcome = JSON.parse(said)?.outcome ?? outcome;
        } catch {
          // not the verdict
        }
      }
    }
    reviews.push({ file, text: texts.join('\n'), outcome });
  }
  return reviews;
}

/** The kit's CLI and bots folder, as words, out of the rules the kit wrote: the mail check rule is `Bash(<CLI> message check --bots <BOTS>:*)`. */
function kitIn(rules) {
  const found = rules.map((rule) => /^Bash\((.+) message check --bots (.+):\*\)$/.exec(rule)).find((one) => one !== null);
  assert.ok(found !== undefined, `the kit should write a rule for its mail check, and wrote: ${JSON.stringify(rules)}`);
  return { cli: found[1], bots: found[2] };
}

/** The conversation the kit's hook wrote into the book for a session, or undefined while there is none. */
function conversationOf(home, session) {
  const id = bookIn(home).sessions?.[session]?.session;
  return typeof id === 'string' ? id : undefined;
}

/**
 * The harnesses this check runs on, one entry each. An entry says, for its
 * harness: the default rules the kit offers a bot (so the words the bot's
 * commands are spelled with can be read back out of them), the bot's own rules
 * file and what it holds for the rules the user allowed, which files hold the
 * rules the harness goes by and which of their rules match a call, how the
 * calls a conversation made are read back and whether a reviewer saw one, how
 * the bot reads the long body, what became of the command no rule covers, and
 * which of its own questions are first-run screens rather than a permission.
 */
const HARNESSES = [
  {
    name: 'claude',
    title: 'Claude Code',
    bot: 'perm-claude',
    display: 'Perm Claude',

    kitIn,

    /** The kit's default set (#527), spelled in test/helpers/permissions.js, with this checkout's CLI in it. */
    defaults: (bots) => defaultRules({ cli: cliEntry }, bots),

    /**
     * The exact rules the bot's charter grants (CHARTER_GRANT), as Bot Father
     * lists them for the user's yes: only `gh release create`, in Claude
     * Code's form.
     */
    granted: ['Bash(gh release create:*)'],

    /** The bot's own settings file, the one the kit writes. */
    ownFile: (home) => path.join(home, '.claude', 'settings.json'),

    /** What the file allows, and what it should allow for the rules in allow: the same rules, SendMessage aside. */
    inFile: claudeAllowIn,
    linesFor: (rules) => rules.filter((rule) => !isSendMessage(rule)),

    /** What the file should hold for the default set alone. */
    defaultLines: (bots) => defaultRules({ cli: cliEntry }, bots),

    /**
     * Every file Claude Code's docs say it takes permission rules from for a
     * session started in `home`, a folder of the bots repo: the user's, the
     * project's and the local one, in the working folder and at the git root,
     * and the managed file at the macOS path the settings docs give it (not
     * re-checked for this test; absent on this machine when it was written).
     */
    ruleFiles: (bots, home) => [
      path.join(os.homedir(), '.claude', 'settings.json'),
      path.join(home, '.claude', 'settings.json'),
      path.join(home, '.claude', 'settings.local.json'),
      path.join(bots, '.claude', 'settings.json'),
      path.join(bots, '.claude', 'settings.local.json'),
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    ],

    covering: claudeCovering,
    callsOf: (home, session) => {
      const id = conversationOf(home, session);
      return id === undefined ? [] : claudeCalls(home, id);
    },

    /** Claude Code has no reviewer of its own to read back: its check is the classifier, which nothing names. */
    reviewOf: () => undefined,

    /** The long body, read with its Read tool. */
    readStep: {
      what: 'its read of the long message\'s file',
      step: () => 'Then read the file the long message names with your Read tool, not with a shell command, and find code word two in it.',
      kind: 'read',
      starts: (kit) => `${kit.folder}.messages/`,
    },
    readsFile: (call, file) => call.kind === 'read' && call.text === file,

    sessionArgs: [],
    firstRun: (title) => ` Answer Claude Code's folder trust in ${title}.`,

    uncoveredStep: (file) => `Last, run exactly this command, once: touch ${file} . If it is refused, do not run it again or try any other way.`,
    uncoveredMs: UNCOVERED_MS,

    /**
     * What became of the command no rule covers, or undefined while nothing
     * has: it ran, it was refused (an error result), or the user was asked.
     */
    decide: (tries, question) => {
      const [call] = tries;
      if (call?.result !== undefined) return { call, how: call.result.error ? 'refused' : 'ran' };
      return call !== undefined && question !== undefined ? { call, how: 'asked', question } : undefined;
    },

    /** Any of those is the check deciding it. */
    problem: () => undefined,

    /** Claude Code's offer to learn the machine: a first-run screen, answered `2. Not now` (tech notes). */
    ownQuestion: (rows) => rows.some((row) => row.includes('Teach auto mode about your environment')),
  },
  {
    name: 'codex',
    title: 'Codex',
    bot: 'perm-codex',
    display: 'Perm Codex',

    kitIn,

    /** The set a bot only on Codex is given: the default set without the Read rule. */
    defaults: (bots) => codexDefaultRules({ cli: cliEntry }, bots),

    /** The same grant, in the same Claude text: bot.yaml keeps the yes in that text for either harness. */
    granted: ['Bash(gh release create:*)'],

    /** The bot's own Codex rules file, which the kit owns whole. */
    ownFile: (home) => path.join(home, '.codex', 'rules', 'obk.rules'),

    /** Its rule lines, and the lines it should hold for the rules in allow. */
    inFile: codexLinesIn,
    linesFor: codexLinesFor,

    /** What the file should hold for the default set alone, in Codex's form. */
    defaultLines: (bots) => codexDefaultLines({ cli: cliEntry }, bots),

    /**
     * Every rules file Codex reads for a session started in `home`: each
     * `.rules` file in the user's, the bots repo root's and the bot folder's
     * `.codex/rules` (Codex's rules docs; the bot folder's seen live, tech
     * notes section 3),
     * the bot's own obk.rules first, whether it is there yet or not.
     */
    ruleFiles: (bots, home) => [...new Set([
      path.join(home, '.codex', 'rules', 'obk.rules'),
      ...[path.join(os.homedir(), '.codex', 'rules'), path.join(bots, '.codex', 'rules'), path.join(home, '.codex', 'rules')].flatMap(rulesFilesIn),
    ])],

    covering: codexCovering,
    callsOf: (home, session) => {
      const id = conversationOf(home, session);
      const file = id === undefined ? undefined : rolloutOf(id);
      return file === undefined ? [] : codexCalls(file);
    },

    /**
     * The auto reviewer's verdict on a call, or undefined when it had none: a
     * call that did not ask to leave the sandbox went to no reviewer, and one
     * that did was reviewed when a review of this conversation names it.
     */
    reviewOf: (home, session, call) => {
      const id = conversationOf(home, session);
      if (!call.escalated || id === undefined) return undefined;
      const said = call.text.replaceAll(/\s+/g, ' ');
      return guardianReviews(id).find((review) => review.text.includes(call.text) || review.text.replaceAll(/\s+/g, ' ').includes(said));
    },

    /** The long body, read with `cat`: Codex has no Read tool, and its sandbox reads every file, so no rule is needed. */
    readStep: {
      what: 'its read of the long message\'s file',
      step: () => 'Then read the file the long message names with exactly this command: cat <the file\'s path, as the message names it> , and find code word two in it.',
      kind: 'command',
      starts: (kit) => `cat ${kit.folder}.messages/`,
      prefix: true,
      ruled: false,
    },
    readsFile: (call, file) => call.kind === 'command' && call.text.startsWith('cat ') && call.text.includes(file),

    /** The test's own sandbox: not /tmp and not $TMPDIR, where the throwaway bots folder is (see the header). */
    sessionArgs: [
      '--extra-arg=-c', '--extra-arg=sandbox_workspace_write.exclude_tmpdir_env_var=true',
      '--extra-arg=-c', '--extra-arg=sandbox_workspace_write.exclude_slash_tmp=true',
    ],
    firstRun: (title) => ` Accept an update offer (1) in ${title}. A folder-trust or hooks-review screen there means the launch-time trust did not take (#240).`,

    uncoveredStep: (file) => `Last, run exactly this command: touch ${file} . If the sandbox stops it, ask once to run that same command outside the sandbox;`
      + ' if that is refused too, do not run it again or try any other way.',
    uncoveredMs: UNCOVERED_MS + ESCALATION_MS,

    /**
     * What became of the command no rule covers, or undefined while nothing
     * has: the bot asked to leave the sandbox and the reviewer decided it (or
     * nothing did), the sandbox stopped it and the bot did not ask to leave it
     * within ESCALATION_MS, it ran inside the sandbox, or the user was asked.
     */
    decide: (tries, question, state, reviewOf) => {
      const left = tries.find((call) => call.escalated);
      if (left?.result !== undefined) {
        const review = reviewOf(left);
        return review === undefined
          ? { call: left, how: `left the sandbox with no review and ${left.result.error ? 'was refused' : 'ran'}` }
          : { call: left, how: `the reviewer's outcome was ${review.outcome}`, review };
      }
      if (left !== undefined) return question === undefined ? undefined : { call: left, how: 'asked', question };
      const [first] = tries;
      if (first === undefined) return undefined;
      if (first.result === undefined) return question === undefined ? undefined : { call: first, how: 'asked', question };
      if (!first.result.error) return { call: first, how: 'ran inside the sandbox' };
      state.stoppedAt ??= Date.now();
      return Date.now() - state.stoppedAt < ESCALATION_MS ? undefined : { call: first, how: 'stopped by the sandbox, and no escalation was asked' };
    },

    /** Only the sandbox and the reviewer may decide it: not a sandbox that let it write, and not leaving it with no review. */
    problem: (outcome) => {
      if (outcome.how === 'ran inside the sandbox') {
        return 'the sandbox let it write beside the bots folder, so the test\'s own sandbox settings did not hold and this run shows nothing about the sandbox';
      }
      if (outcome.how.startsWith('left the sandbox with no review')) return 'it left the sandbox with no review, which only a rule does';
      return undefined;
    },

    /** Codex's first-run screens: the update offer, which the person running the test answers, and folder trust and hooks review, which the launch-time trust (#240) should keep away. */
    ownQuestion: (rows) => rows.some((row) => /Trust this folder\?|Hooks need review|Update available!/.test(row)),
  },
];

/** What the bot's charter grants beyond the defaults: publishing releases without asking (#353). */
const CHARTER_GRANT = 'It publishes releases without asking.';

/** The Codex bot the reply goes to. Codex, so that the pair is not Claude Code's own messaging road. */
const PEN_PAL = { name: 'pen-pal', display: 'Pen Pal' };

/** The words the mail carries, which the bot is never told: one in the short message, one in the long one's file. */
const SHORT_WORD = 'HERON-5521';
const LONG_WORD = 'OCELOT-8817';

const SHORT = { subject: 'the short one', text: `Code word one: ${SHORT_WORD}.` };

/** Over the kit's 4 KiB limit, so it travels as a file; short lines, so a Read shows every one. */
const LONG = {
  subject: 'the long one',
  text: [
    'A long message for the permissions system test. Code word two is further down.',
    ...Array.from({ length: 80 }, (_, n) => `Filler line ${n + 1} of the first half, with nothing in it to act on.`),
    `Code word two: ${LONG_WORD}.`,
    ...Array.from({ length: 80 }, (_, n) => `Filler line ${n + 1} of the second half, with nothing in it to act on.`),
  ].join('\n'),
};

/** The file the test puts in the bot's folder for the bot to commit. */
const COMMIT_FILE = 'permissions-check.txt';

/**
 * What the bot is asked to do that an allowed rule must let through, in the
 * order it does it, for one harness. Each entry is one step of its start
 * prompt, and how its call is known in the transcript: `kind` and the text the
 * call starts with (`prefix` when that text is the start of a path). `kit`
 * holds the kit's CLI and bots folder as words (`cli`, `bots`), the bots folder
 * as a path (`folder`), and the bot's name. The read of the long body is the
 * harness's own (`readStep`); on Codex it is marked `ruled: false`, since its
 * sandbox reads every file and no rule is written for it. The last entry is
 * the charter's grant (#353), marked `grant`, let through by the rule the user
 * allowed for it and by no rule in another file.
 */
const coveredFor = (harness) => [
  {
    what: 'its mail check',
    step: (kit) => `As soon as you are running, read your mail with exactly this command: ${kit.cli} message check --bots ${kit.bots} --bot ${kit.bot} --session daily`
      + ' . If it has not shown you both messages, run the same command again a few seconds later, until it has.'
      + ' If a line arrives saying fleet mail is waiting, run exactly the command that line names.',
    kind: 'command',
    starts: (kit) => `${kit.cli} message check --bots ${kit.bots}`,
  },
  harness.readStep,
  {
    what: 'its ask for the road',
    step: (kit) => `Then ask the kit for the road to ${PEN_PAL.name}/daily with exactly this command: ${kit.cli} message to --bots ${kit.bots} --to ${PEN_PAL.name}/daily`,
    kind: 'command',
    starts: (kit) => `${kit.cli} message to --bots ${kit.bots}`,
  },
  {
    what: 'its reply',
    step: () => 'Then send your reply with the send command that answer names, with the subject \'permissions reply\','
      + ' and as its text code word one, a space, and code word two.',
    kind: 'command',
    starts: (kit) => `${kit.cli} message send --bots ${kit.bots}`,
  },
  {
    what: 'its git add',
    step: () => `Then run exactly: git add -- ${COMMIT_FILE}`,
    kind: 'command',
    starts: () => 'git add',
  },
  {
    what: 'its git commit',
    step: () => `Then run exactly: git commit -m 'permissions check CODE' -- ${COMMIT_FILE} , with CODE replaced by code word two.`,
    kind: 'command',
    starts: () => 'git commit',
  },
  {
    what: 'its charter\'s release, as help only',
    step: () => 'Then run exactly: gh release create --help',
    kind: 'command',
    starts: () => 'gh release create',
    grant: true,
  },
];

/**
 * The command no rule covers, last. `touch` on a file beside the bots folder:
 * not read-only, and not an edit inside the bot's working folder, so by the
 * order Claude Code's docs give it is neither of the two things decided before
 * the classifier; and outside every folder Codex's sandbox (as this test sets
 * it) may write. Harmless either way, and what became of it is on the disk.
 * Its step is the harness's (`uncoveredStep`): a Codex bot is told to ask once
 * to leave the sandbox, which is what brings its reviewer in.
 */
const UNCOVERED = {
  what: 'a command no rule covers',
  file: (kit) => `${kit.folder}.uncovered.txt`,
  step: (kit, harness) => harness.uncoveredStep(`${kit.folder}.uncovered.txt`),
  kind: 'command',
  starts: (kit) => `touch ${kit.folder}.uncovered.txt`,
};

/** Whether a call is one a case asks for: the same kind, and its text starting with the case's words. */
function isCallOf(entry, kit, call) {
  if (call.kind !== entry.kind) return false;
  const start = entry.starts(kit);
  return entry.kind === 'read' || entry.prefix ? call.text.startsWith(start) : call.text === start || call.text.startsWith(`${start} `);
}

/** The bot's whole part, in its start prompt: nothing is typed into its tab but the kit's own lines. */
const botPrompt = (kit, harness) => [
  'You are a system test\'s bot and you own nothing.',
  `Your bots folder is ${kit.folder}.`,
  'Do nothing that is not written here: read no file but the one the long message names, write nothing,'
  + ' and run no command but the ones below.',
  'Run each command exactly as it is written here, or as the kit\'s answer gives it, on its own:'
  + ' nothing before it or after it, no cd, no pipe and no redirection.',
  `Two messages from ${PEN_PAL.name}/daily are waiting for you: a short one with code word one in it,`
  + ' and a long one whose text is in a file the message names, with code word two in that text.',
  ...coveredFor(harness).map((entry) => entry.step(kit)),
  UNCOVERED.step(kit, harness),
  'Then say nothing else and wait.',
].join(' ');

/** The pen pal's part: nothing at all. The reply only has to reach its mailbox. */
const PEN_PAL_PROMPT = 'You are a system test\'s pen pal and you own nothing. Run no command, read no file, write nothing'
  + ' and use no tool. If a line says fleet mail is waiting, leave it unread and say nothing. Say nothing now and wait.';

/** One line per call, for a message: what it was and what it answered. */
const callLines = (calls) => calls
  .map((call) => `\n    ${call.kind} ${call.text}${call.result === undefined ? '  (no result yet)' : call.result.error ? `  (error: ${call.result.output.slice(0, 300)})` : ''}`)
  .join('');

for (const harness of HARNESSES) {
  test(`a ${harness.name} bot in auto mode runs the kit's default commands with no prompt, its own granted rule once the user said yes, and a command no rule covers still goes to the check`, async (t) => {
    const before = {
      handles: new Set(allTerminals().map((terminal) => terminal.handle)),
      setups: new Set(allSetups().map((setup) => setup.id)),
    };

    const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-permissions-')));
    const homeOf = (bot) => path.join(bots, 'bots', bot);
    const homes = ['bot-father', PEN_PAL.name, harness.bot].map(homeOf);
    const home = homeOf(harness.bot);

    // Registered before anything is created, so it runs however this test ends.
    t.after(async () => {
      // Only this test's own tabs are closed. A tab it did not create at one of
      // its homes is not its to close: that project and the bots folder stay
      // where they are, and the test fails naming the tab (#426).
      const { closed, foreign } = guard.closeOwnAt(homes);
      const held = new Set(foreign.map((one) => one.home));
      const failedDeletes = [];
      for (const setup of allSetups()) {
        if (!homes.includes(setup.path) || before.setups.has(setup.id) || held.has(setup.path)) continue;
        try {
          await deleteOwnProject(setup, bots);
        } catch (error) {
          failedDeletes.push(`${setup.path}: ${error.message}`);
        }
      }
      assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
      await removeBotsFolderAndSiblings(bots);

      // The point of all the care above: this test closed no tab but its own. A
      // tab open before it and gone now that it did not close was closed by
      // someone else on this shared machine, so that is said, not failed (#246).
      const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
      assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
      if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
      for (const each of homes) {
        assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
      }
      assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
    });

    obkJson(['init', '--bots', bots, '--harness', 'claude']);
    obkJson([
      'bot', 'create', '--bots', bots, '--name', PEN_PAL.name, '--harness', 'codex',
      '--charter', `${PEN_PAL.display} exists for one system test run and owns nothing.`,
    ]);
    obkJson(['session', 'add', '--bots', bots, '--bot', PEN_PAL.name, '--name', 'daily', `--prompt=${PEN_PAL_PROMPT}`, ...codexTrustArgs(bots)]);

    // 1. The bot is made, and the kit writes its default set itself, with
    //    nobody asked (#527): it says which rules it added, and nothing waits.
    const created = obkJson([
      'bot', 'create', '--bots', bots, '--name', harness.bot, '--harness', harness.name,
      '--charter', `${harness.display} exists for one system test run and owns nothing else. ${CHARTER_GRANT}`,
    ]);
    const defaults = harness.defaults(bots);
    assertSameRules(addedTo(created, harness.bot), defaults, 'bot create should say it added the default set, every rule of it once');

    const written = await allowedIn(home);
    assertSameRules(written, defaults, 'bot.yaml\'s allow should hold the default set, and nothing else the kit chose');
    const words = harness.kitIn(written);
    // The bot's commands will be spelled with these words, so they must name
    // this checkout's CLI and this throwaway folder, never the machine's `obk`.
    assert.ok([cliEntry, `'${cliEntry}'`].includes(words.cli), `the rules should name this checkout's CLI, ${cliEntry}, and name ${words.cli}`);
    assert.ok([bots, `'${bots}'`].includes(words.bots), `the rules should name this bots folder, ${bots}, and name ${words.bots}`);
    const kit = { ...words, folder: bots, bot: harness.bot };
    const covered = coveredFor(harness);

    // Written at once into the bot's own file, before anything is brought up.
    const ownFile = harness.ownFile(home);
    assertSameRules(harness.inFile(ownFile), harness.defaultLines(bots), `${ownFile} should hold the default set as soon as bot create returns`);

    // 2. The yes to the charter's grant, as Bot Father runs it after showing
    //    the user the exact rule. Not written before it; after it, the rules
    //    already there keep their place and the charter's rule comes after.
    for (const rule of harness.granted) {
      const lines = harness.linesFor([rule]);
      assert.ok(!harness.inFile(ownFile).some((line) => lines.includes(line)), `${rule} should not be in ${ownFile} before the user said yes to it`);
    }
    const grantedYes = obk(['permission', 'allow', '--bots', bots, '--bot', harness.bot, ...harness.granted.flatMap((rule) => ['--rule', rule])]);
    assert.equal(grantedYes.status, 0, `the yes to the charter's rule should go through: ${grantedYes.stdout}${grantedYes.stderr}`);
    const allowedNow = [...written, ...harness.granted];
    assert.deepEqual(await allowedIn(home), allowedNow, 'bot.yaml should keep the defaults where they were, then the charter\'s rule');
    assertSameRules(harness.inFile(ownFile), harness.linesFor(allowedNow), `${ownFile} should hold the defaults and the charter's rule`);

    // The bot's part, and the file it commits.
    await writeFile(path.join(home, COMMIT_FILE), 'A file for the permissions system test to commit.\n');
    obkJson([
      'session', 'add', '--bots', bots, '--bot', harness.bot, '--name', 'daily', `--prompt=${botPrompt(kit, harness)}`,
      ...harness.sessionArgs, ...(harness.name === 'codex' ? codexTrustArgs(bots) : []),
    ]);

    // 3. Up: the pen pal first, whose mailbox the reply goes to, then the bot.
    //    Nothing waits for a yes, and nothing is left to add.
    const mailboxOf = (bot) => until(
      `${bot}/daily to have its mailbox in the book`,
      MAILBOX_MS,
      async () => {
        const { mailbox } = await sessionIn(homeOf(bot), 'daily');
        return /^run_/.test(String(mailbox)) ? mailbox : undefined;
      },
    );
    tabOf(obkJson(['up', '--bots', bots, '--bot', PEN_PAL.name]), 'daily');
    const penPalRun = await mailboxOf(PEN_PAL.name);

    const up = obkJson(['up', '--bots', bots, '--bot', harness.bot]);
    assertSameRules(addedTo(up, harness.bot), [], 'the defaults are all there, so up should add none and nothing should wait');
    const entry = tabOf(up, 'daily');
    assert.equal(entry.created, true);
    assert.equal(
      entry.harnessStarted,
      true,
      `no ${harness.name} came up in ${entry.title}: look at it with \`orca terminal read --terminal ${entry.terminal} --screen\``,
    );
    const handle = entry.terminal;
    const botRun = await mailboxOf(harness.bot);

    // 4. The mail, sent while the tab is still on its first-run screen, so both
    //    are waiting when the bot first checks. The kit types nothing into a tab
    //    on that screen, and says so; the bot's start prompt is its wake-up.
    const send = (message) => obkJson([
      'message', 'send', '--bots', bots, '--to', `${harness.bot}/daily`, '--from', `${PEN_PAL.name}/daily`,
      '--subject', message.subject, '--text', message.text,
    ]);
    const sentLong = send(LONG);
    const sentShort = send(SHORT);
    for (const [which, sent] of [['long', sentLong], ['short', sentShort]]) {
      assert.equal(sent.sent, true, `the ${which} message should be in the mailbox: ${JSON.stringify(sent)}`);
      t.diagnostic(`the ${which} message: nudged ${JSON.stringify(sent.nudged)}${sent.blocked === undefined ? '' : `, blocked ${sent.blocked}`}`);
    }
    assert.equal(typeof sentLong.file, 'string', `the long message should have gone as a file: ${JSON.stringify(sentLong)}`);
    assert.ok(sentLong.file.startsWith(`${bots}.messages${path.sep}`), `and into ${bots}.messages, which the Read rule names: ${sentLong.file}`);
    assert.equal(sentShort.file, undefined, `the short message should have gone as itself: ${JSON.stringify(sentShort)}`);

    // 5. The harness is running once the folder trust is answered: the kit's
    //    hook writes its conversation into the book.
    await until(
      `${harness.bot}/daily to report its conversation`,
      READY_MS,
      async () => ((await sessionIn(home, 'daily')).session === undefined ? undefined : true),
      () => `${harness.firstRun(entry.title)}${whatIsUp(handle)}`,
    );

    // 6. The default calls, each with its result, and nobody asked a thing
    //    while they were made. A refused one fails at once, with what it said.
    const calls = () => harness.callsOf(home, 'daily');
    const made = await until(
      `${harness.bot} to make every default call`,
      DEFAULTS_MS,
      async () => {
        const now = calls();
        for (const step of covered) {
          const refused = now.find((call) => isCallOf(step, kit, call) && call.result?.error === true);
          assert.equal(refused, undefined, `${step.what} came back as an error: ${JSON.stringify(refused)}`);
        }
        if (covered.every((step) => now.some((call) => isCallOf(step, kit, call) && call.result !== undefined))) return now;
        // Not done, so a default call is still to come or still waiting: a
        // question now is about it (or about something the bot was not asked).
        const open = now.filter((call) => call.result === undefined).at(-1);
        assertNothingAsked(handle, harness, open === undefined ? 'none yet' : `${open.kind} ${open.text}`);
        return undefined;
      },
      () => `${callLines(calls())}${whatIsUp(handle)}`,
    );

    // What let each default call through: a rule in the bot's own rules file,
    // which holds only what the user allowed. A rule elsewhere that covers it
    // too is said, not failed: the kit's rule was there either way. For the
    // charter's grant it fails: the run could not show the kit's rule did it.
    // A call no rule is written for (Codex's read of the long body) is said as
    // such. And on Codex, no default call went to the reviewer.
    const ruleFiles = harness.ruleFiles(bots, home);
    for (const step of covered) {
      for (const call of made.filter((one) => isCallOf(step, kit, one))) {
        const review = harness.reviewOf(home, 'daily', call);
        assert.equal(
          review,
          undefined,
          `${step.what}, run as \`${call.text}\`, went to ${harness.title}'s reviewer (${review?.file}, outcome ${review?.outcome}): a default call must go through with no review`,
        );
        if (step.ruled === false) {
          t.diagnostic(`${step.what}: \`${call.text}\` needs no rule, and went through with no review`);
          continue;
        }
        const own = harness.covering(ownFile, call).allow;
        assert.notDeepEqual(
          own,
          [],
          `${step.what}, run as \`${call.text}\`, is covered by no rule in ${ownFile}: the command the bot ran is not what the kit's rule covers`,
        );
        const elsewhere = ruleFiles
          .filter((file) => file !== ownFile)
          .flatMap((file) => harness.covering(file, call).allow.map((rule) => `${rule} in ${file}`));
        t.diagnostic(`${step.what}: \`${call.text}\` let through by ${own.join(', ')}${elsewhere.length === 0 ? '' : `; also covered by ${elsewhere.join(', ')}`}`);
        if (step.grant) {
          assert.deepEqual(
            elsewhere,
            [],
            `the gate is inconclusive: ${step.what}, run as \`${call.text}\`, is also covered by an allow rule outside ${ownFile} (${elsewhere.join('; ')}),`
              + ' so this run cannot say the kit\'s rule for the charter\'s grant is what let it through.',
          );
        }
      }
    }

    // 7. The mail was read, by the harness's own record: the short message's
    //    word came back from the bot's own mail check, the long one's file was
    //    named there, and its word came back from the bot's own read of it.
    const checks = made.filter((call) => isCallOf(covered.find((step) => step.what === 'its mail check'), kit, call));
    assert.ok(checks.some((call) => call.result.output.includes(SHORT_WORD)), `a mail check should have shown the short message's ${SHORT_WORD}:${callLines(checks)}`);
    assert.ok(checks.some((call) => call.result.output.includes(sentLong.file)), `a mail check should have named the long message's file:${callLines(checks)}`);
    const reads = made.filter((call) => harness.readsFile(call, sentLong.file));
    assert.ok(reads.some((call) => call.result.output.includes(LONG_WORD)), `the read of ${sentLong.file} should have shown ${LONG_WORD}:${callLines(reads)}`);

    // And by Orca's store: both messages are in the bot's Run, read. The reply
    // is in the pen pal's, the only mail it has, carrying both words, one of
    // which the bot could only have got from the file.
    const inbox = await until(
      `the reply to show in Orca's inbox for ${PEN_PAL.name}/daily`,
      INBOX_MS,
      async () => {
        const found = inboxOf({ bot: botRun, penPal: penPalRun });
        return found.penPal.length > 0 ? found : undefined;
      },
    );
    for (const message of [SHORT, LONG]) {
      const found = inbox.bot.filter((one) => one.subject === message.subject);
      assert.equal(found.length, 1, `${harness.bot}'s Run should hold ${message.subject}, and the newest ${INBOX_LIMIT} of the inbox hold: ${JSON.stringify(inbox.bot)}`);
      assert.equal(
        found[0].read,
        1,
        `${message.subject} should be read: the bot's own mail check shows it. Either the inbox's \`read\` does not mean acknowledged, or the check did not acknowledge it: ${JSON.stringify(found[0])}`,
      );
    }
    assert.equal(inbox.penPal.length, 1, `${PEN_PAL.name}'s Run should hold the one reply: ${JSON.stringify(inbox.penPal)}`);
    for (const word of [SHORT_WORD, LONG_WORD]) {
      assert.ok(String(inbox.penPal[0].body).includes(word), `the reply should carry ${word}: ${JSON.stringify(inbox.penPal[0])}`);
    }

    // 8. The commit, by git's own record in the bots repo: the file is in a
    //    commit whose message carries the long message's word, and it is clean.
    const inRepo = path.join('bots', harness.bot, COMMIT_FILE);
    const git = (args) => {
      const done = spawnSync('git', ['-C', bots, ...args], { encoding: 'utf8' });
      assert.equal(done.status, 0, `git ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
      return done.stdout;
    };
    const commits = git(['log', '--format=%s', '--', inRepo]).split('\n').filter((line) => line !== '');
    assert.equal(commits.length, 1, `one commit should hold ${inRepo}, and git's log for it is: ${JSON.stringify(commits)}`);
    assert.ok(commits[0].includes(LONG_WORD), `the commit should be the bot's, its message carrying ${LONG_WORD}: ${commits[0]}`);
    assert.equal(git(['status', '--porcelain', '--', inRepo]), '', `${inRepo} should be committed and clean`);

    // 9. The command no rule covers. It is the bot's last step: it is decided
    //    by the check (Claude: it runs, or is refused and the bot told why;
    //    Codex: the sandbox stops it, and the reviewer decides the bot's ask to
    //    leave it), or the user is asked, and nothing here answers.
    const state = {};
    const outcome = await until(
      `${harness.bot} to make ${UNCOVERED.what}, and something to decide it`,
      harness.uncoveredMs,
      async () => {
        const tries = calls().filter((one) => isCallOf(UNCOVERED, kit, one));
        const question = tries.length === 0 ? undefined : questionShown(handle, harness.ownQuestion);
        return harness.decide(tries, question, state, (call) => harness.reviewOf(home, 'daily', call));
      },
      () => `${callLines(calls())}${whatIsUp(handle)}`,
    );
    t.diagnostic(`${UNCOVERED.what}, \`${outcome.call.text}\`: ${outcome.how}${outcome.call.result?.error ? `, saying: ${outcome.call.result.output.slice(0, 500)}` : ''}`);

    // No rule was what decided it: none, in any file the harness takes rules
    // from, covers the command as the bot ran it, whether it allows, asks or
    // refuses. The kit wrote none for it. An allow rule would have let it
    // through, an ask rule would have put the question, and a deny rule would
    // have refused it, each before the harness's own check was reached, so a
    // run with any of them says nothing about the check, whatever became of
    // the command. (Codex's `prompt` and `forbidden` are read as ask and deny.)
    const covering = Object.fromEntries(RULE_KINDS.map((kind) => [kind, []]));
    for (const file of ruleFiles) {
      const found = harness.covering(file, outcome.call);
      for (const kind of RULE_KINDS) {
        covering[kind].push(...found[kind].map((rule) => `${rule} in ${file}`));
      }
    }
    assert.deepEqual(covering.allow, [], `no allow rule may cover \`${outcome.call.text}\`, or this run shows nothing about the check`);
    for (const kind of ['ask', 'deny']) {
      assert.deepEqual(
        covering[kind],
        [],
        `the gate is inconclusive: the command ${outcome.how}, and a ${kind} rule covers \`${outcome.call.text}\` (${covering[kind].join('; ')}).`
          + ` ${harness.title} decides a call by a matching ${kind} rule before its own check, so this run cannot say the check decided it.`,
      );
    }
    assertSameRules(harness.inFile(ownFile), harness.linesFor(allowedNow), `${ownFile} should still hold exactly the defaults and the rule the user allowed`);

    // Only the harness's own check decided it (on Codex: the sandbox or the
    // reviewer, not a sandbox that let it write, and not leaving it unreviewed).
    const problem = harness.problem(outcome);
    assert.equal(problem, undefined, `${UNCOVERED.what}, \`${outcome.call.text}\`, ${outcome.how}: ${problem}`);

    // And the disk agrees with what the record says became of it.
    if (outcome.how !== 'asked') {
      const ran = !outcome.call.result.error;
      assert.equal(
        existsSync(UNCOVERED.file(kit)),
        ran,
        `the record says it ${outcome.how}${ran ? '' : ' (a refusal)'}, and ${UNCOVERED.file(kit)} ${existsSync(UNCOVERED.file(kit)) ? 'is' : 'is not'} there`,
      );
    }
  });
}
