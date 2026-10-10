// A system test: a bot that follows one of the kit's skills reaches the CLI
// that launched its tab, and the machine's `obk` is neither run nor touched
// (#239, its second box). Against the real Claude Code in the real Orca on this
// machine. Run it alone with
// `npm run test:system -- --yes test/system/skill-reaches-cli.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The skills are linked files, the same on every machine, and say `obk …`; a
// note near each one's top says to run `"${OBK_CLI:-obk}"`, the kit that started
// the tab, wherever the skill says `obk`. A tab the kit launched carries
// `OBK_CLI=<the CLI that launched it>` (#220). Here that is this checkout's
// `src/cli.js`, and the machine's `obk` is the published release, a different
// program at a different path. This test asks a bot to do what a skill says,
// without spelling out the command, and looks at which of the two did it.
//
// The skill and the step: obk-bot-building says a rule unit that applies to code
// is carried only when the bot's `rules:` list names it, "add them … by hand and
// run `obk rules build`". So:
//
//   1. A throwaway fleet: Bot Father; `reader-bot`, a Claude bot with the
//      obk-bot-building skill linked and one session, `daily`, which the kit
//      launches; and `target-bot`, a bot with no sessions.
//   2. The test edits target-bot's `bot.yaml` by hand, adding `kit:tests-first`
//      to its `rules:` list, as the skill describes.
//   3. It asks reader-bot, in one line typed into its own tab, to do what the
//      obk-bot-building skill says to do after that edit, for target-bot. The
//      line names the skill, the bots folder and the edit, and no command.
//      The checks below run once reader-bot's turn is over: it said the done
//      word the line asks for, or its tab sat idle at its prompt with its
//      record unchanged. A bot can rightly end its turn on a question to the
//      user instead, such as a yes for the permission rules the build listed
//      (live run 3), and that is no failure of the test's.
//
// How the two CLIs are told apart, without touching the machine's `obk`:
//
//   - By what the command leaves behind. `obk rules build` writes a bot's
//     AGENTS.md whole, from its rule units, and writes the path of the CLI that
//     built it where a unit says `"${OBK_CLI:-obk}"` (#344): the mail rule's
//     `<cli> message to --bots <bots> …` line. So once reader-bot is done,
//     target-bot's AGENTS.md has to carry the tests-first unit (a build ran
//     after the edit) and name this checkout's CLI on that line, and not the
//     machine's `obk`. Only a build by this checkout writes that.
//   - By the harness's own record of what it ran: every shell command in
//     reader-bot's Claude Code transcript (`~/.claude/projects/<folder>/<id>.jsonl`,
//     read only, this test's own conversation). None may start a bare `obk`, or
//     name the machine's `obk` by its path, in its code: text in quotes, a
//     heredoc's body and a comment run nothing and are not read for it
//     (test/helpers/shell-command.js). They are all printed as diagnostics.
//   - And the machine's `obk` is untouched: its file and its package.json are
//     read (`stat`, one file each) before and after, and must be the same.
//
// The premises: reader-bot's `claude` carries `OBK_CLI` naming this checkout's
// CLI (`ps -E`, one pid, searched for the word and never printed), and the
// skill is linked in its folder.
//
// What it cannot show:
//
//   - Codex. Only a Claude bot is asked. Codex puts `/opt/homebrew/bin` back
//     in front of PATH in its shell tool (tech notes, section 1), so on Codex a
//     bare `obk` is the machine's too, and the note is what reaches the right
//     CLI; that is not run here.
//   - Why the bot reached the checkout. Its own AGENTS.md names this checkout's
//     CLI by path in the mail rule, so a bot could copy the path from there
//     rather than follow the skill's note. Either way it reached the CLI that
//     launched its tab, which is the requirement; the transcript's commands,
//     printed, say which way it went.
//   - Every command of every skill. One skill and one command are asked.
//   - A machine with no `obk` on PATH: then there is nothing for a bare `obk`
//     to reach, and the test says so in a diagnostic.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`, and never runs, links or installs over the machine's `obk`;
//   - types one line, only into reader-bot's own tab, and only at Claude Code's
//     plain input prompt: the suite's shared look (helpers/screens.js) finds no
//     question, form or menu, and the lowest `❯` row is the input line between
//     the input box's rules. Anything else fails the test with the screen, and
//     nothing is typed;
//   - closes only its own tabs, through the tab guard (`guard.closeOwnAt`),
//     then deletes its own workspaces, whatever happened;
//   - signals no process; `ps` is read one pid at a time.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all.
//
// **It is attended.** The bots folder is `<tmp>/obk-system-skill-cli-*`. What
// to expect, in order:
//
//   1. `Bot Father daily`: Claude Code's folder trust. Nothing here waits on
//      Bot Father. Leave it.
//   2. `Reader Bot daily` (bot `reader-bot`): Claude Code's folder trust. Its
//      selection starts on `No, exit`, so it takes a down-arrow and then return.
//   3. `Reader Bot daily`, after its first turn: Claude Code's form "Teach auto
//      mode about your environment?". Esc cancels it. The test types its line
//      only once the form is gone; while it is up, the test waits and then
//      fails with the screen.
//   4. `Reader Bot daily`: if Claude Code asks before it runs the command the
//      skill names, allow it. Whichever CLI it names, the answer is the finding.
//   5. Any tab, if its harness offers an update: accept it (PRD 6.5).
//
// It takes a few minutes: one harness, one start turn and one asked turn.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, repoRoot, spellingsOf } from '../helpers/cli.js';
import { questionOn, waitingOn } from '../helpers/screens.js';
import { codeOf, startsBareObk } from '../helpers/shell-command.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts` and the rest are siblings of the bots folder (PRD 6.3).
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

/** How long a real agent is given to answer, a permission asked of the person attending included. */
const ANSWER_MS = 300000;

/** How long a tab is given to be ready for a line, a person answering its first-run screens included. */
const READY_MS = 180000;

/**
 * Ask Orca something and read its JSON. Never the blanket close, on any road.
 * Every tab it opens or closes is counted as this test's, for the check at the end.
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

/** The tabs Orca lists at `home` once it has caught up with what was closed. */
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
 * published release this machine uses, not the code under test (#217, #220).
 */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. A tab it says it opened is this test's own. */
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

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/** Keep asking until `look` gives something other than undefined, or the time runs out. */
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
    ' This test answers nothing a tab asks; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/** A row of Claude Code's input box's rules: nothing but `─`, a name set into it aside. */
const RULE_ROW = /^\s*─{8,}/;

/**
 * Why a Claude tab is not at its plain input prompt, or undefined when it is
 * (node-harness-nudge.test.js): the screen can be read, shows no question, form
 * or menu by the suite's shared look, and its lowest `❯` row is the input
 * line, between the input box's two rules.
 */
function notAtPrompt(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  if (shown?.source !== 'screen' || !Array.isArray(shown.tail)) {
    return `its screen could not be read (${answer.ok === true ? `source ${shown?.source}` : JSON.stringify(answer.error)})`;
  }
  const rows = shown.tail;
  const screen = `\n    ${rows.join('\n    ')}`;
  if (questionOn(rows) !== undefined) return `a question, form or menu is up:${screen}`;
  const at = rows.findLastIndex((row) => row.trimStart().startsWith('❯'));
  if (at < 0) return `no input line is on it:${screen}`;
  if (!RULE_ROW.test(rows[at - 1] ?? '') || !RULE_ROW.test(rows[at + 1] ?? '')) {
    return `its lowest ❯ row is not the input line between the input box's rules:${screen}`;
  }
  return undefined;
}

/** Wait until the Claude tab is at its plain input prompt, Orca naming nothing to answer. */
async function atPrompt(handle, within = READY_MS) {
  await until(
    `${handle} to be at its plain input prompt`,
    within,
    async () => {
      const idle = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (idle.ok !== true || idle.result?.wait?.blockedReason !== undefined) return undefined;
      return waitingOn(orca, handle) === undefined && notAtPrompt(handle) === undefined ? true : undefined;
    },
    () => ` ${notAtPrompt(handle) ?? ''}${whatIsUp(handle)}`,
  );
}

/** Type one line into the Claude tab, only at its plain input prompt; otherwise fail, having typed nothing. */
function typeIntoClaude(handle, text) {
  const why = notAtPrompt(handle);
  assert.equal(why, undefined, `this test would type ${JSON.stringify(text)} into ${handle}, but ${why}\n  Nothing was typed.`);
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  assert.equal(sent.ok, true, `orca terminal send --enter failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
}

/** Read `ps` for one pid, and nothing else: it is a reader here and never a road to a signal. */
function psOf(pid, columns) {
  assert.match(String(pid), /^[1-9]\d*$/, `ps is asked about one positive pid, got: ${pid}`);
  const done = spawnSync('ps', [...columns, '-p', String(pid)], { encoding: 'utf8' });
  return done.status === 0 ? done.stdout.trim() : undefined;
}

/** The process in front of a tab's terminal, the way the kit finds it (restored-tab.test.js). */
function inFront(handle) {
  const ptyId = allTerminals().find((terminal) => terminal.handle === handle)?.ptyId;
  const memory = orca(['diagnostics', 'memory']);
  const pane = memory.ok === true
    ? (memory.result?.worktrees ?? []).flatMap((worktree) => worktree.sessions ?? []).find((one) => one.sessionId === ptyId)?.pid
    : undefined;
  if (ptyId === undefined || pane === undefined) return undefined;
  const group = Number(psOf(pane, ['-o', 'tpgid=']));
  if (!Number.isInteger(group) || group <= 0) return undefined;
  const comm = psOf(group, ['-o', 'comm=']);
  return comm === undefined ? undefined : { pid: group, name: path.basename(comm.replace(/^-/, '')) };
}

/** The words `ps -E` prints for one process: only ever looked through for a word, never printed. */
const environmentWords = (pid) => (psOf(pid, ['-E', '-ww', '-o', 'command=']) ?? '').split(/\s+/);

// ------------------------------------------------------------- the machine's obk

/**
 * The machine's `obk`, as this test's own PATH finds it, and what its file and
 * its package.json are now: read with `command -v` and `stat`, never run.
 */
function machineObk() {
  const found = spawnSync('/bin/sh', ['-c', 'command -v obk'], { encoding: 'utf8' });
  const at = found.status === 0 ? found.stdout.trim() : '';
  if (at === '') return undefined;
  const real = realpathSync(at);
  const pkg = path.join(path.dirname(path.dirname(real)), 'package.json');
  const mark = (file) => {
    if (!existsSync(file)) return null;
    const { size, mtimeMs } = statSync(file);
    return { size, mtimeMs };
  };
  return { at, real, file: mark(real), pkg: mark(pkg), version: existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).version : null };
}

// ------------------------------------------------------------- Claude Code's record

/** Where Claude Code keeps a folder's conversations (tech notes, section 2). */
const transcriptsOf = (home) => path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));

/** The whole lines of one conversation's transcript, as JSON. Read only. */
function linesOf(home, id) {
  const file = path.join(transcriptsOf(home), `${id}.jsonl`);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').flatMap((raw) => {
    if (raw.trim() === '') return [];
    try {
      return [JSON.parse(raw)];
    } catch {
      return [];
    }
  });
}

/** Every shell command the conversation ran, as written: the `command` of each Bash tool call. */
const shellCommandsIn = (lines) => lines
  .filter((line) => line.type === 'assistant' && Array.isArray(line.message?.content))
  .flatMap((line) => line.message.content)
  .filter((item) => item?.type === 'tool_use' && item.name === 'Bash' && typeof item.input?.command === 'string')
  .map((item) => item.input.command);

/** The text a line says, where it says it as text: not a tool's answer. */
function textsOf(line) {
  const content = line.message?.content;
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((item) => item?.type === 'text' && typeof item.text === 'string').map((item) => item.text);
}

// ------------------------------------------------------------- the bots

const READER = { name: 'reader-bot', title: 'Reader Bot daily' };
const TARGET = 'target-bot';

/** The rule unit the hand edit adds, and the heading it carries in a bot's AGENTS.md. */
const UNIT = 'tests-first';
const unitTitle = () => /^title:\s*(.+)$/m.exec(readFileSync(path.join(repoRoot, 'rules', `${UNIT}.md`), 'utf8'))?.[1]?.trim();

/** In the start prompt only, and asked for in lower case, so its echo is not its answer. */
const READY = 'READY-6180';
const DONE = 'DONE-4827';

const startPrompt = [
  "You are a system test's bot. You help look after this bots folder when asked, and otherwise own nothing.",
  `Reply now with ${READY} in lower case and nothing else, and then wait.`,
].join(' ');

/** The line typed into reader-bot's tab: the skill, the folder and the edit, and no command. */
const askFor = (bots) => [
  'Use your obk-bot-building skill.',
  `In the bots folder ${bots}, the rules list in ${TARGET}'s bot.yaml was just edited by hand to add kit:${UNIT}.`,
  `Do what that skill says to do after such an edit, for ${TARGET} only, and nothing else.`,
  `When you have done what the skill says, end your reply with ${DONE} in lower case,`,
  'also when you are waiting on a yes for something else.',
].join(' ');

/** How long reader-bot's tab has to stay idle at its prompt, its record unchanged, for its turn to count as over. */
const SETTLED_MS = 10000;

/**
 * Wait, up to ANSWER_MS, for reader-bot's turn to be over, and say how it
 * ended. It is over when the done word is on the screen, or when the ask is in
 * the conversation's record and the tab has sat idle at its plain prompt, with
 * no question up and nothing added to the record, for SETTLED_MS. A bot can
 * rightly end its turn on a question of its own to the user, such as a yes for
 * permission rules the build listed, without the word (live run 3); that is
 * the second way. A question of the harness's own (a permission prompt, a
 * menu) is not idle at the prompt, so the wait goes on for the person
 * attending.
 */
async function turnOver(handle, home, id) {
  let since;
  let count;
  return until(
    'reader-bot\'s turn to be over',
    ANSWER_MS,
    async () => {
      if (screenOf(handle).includes(DONE.toLowerCase())) return 'with the done word';
      const lines = linesOf(home, id);
      const asked = lines.some((line) => line.type === 'user' && textsOf(line).some((text) => text.includes(DONE)));
      const look = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      const idle = look.ok === true && look.result?.wait?.blockedReason === undefined
        && waitingOn(orca, handle) === undefined && notAtPrompt(handle) === undefined;
      if (!asked || !idle) {
        since = undefined;
        return undefined;
      }
      if (since === undefined || lines.length !== count) {
        since = Date.now();
        count = lines.length;
        return undefined;
      }
      return Date.now() - since >= SETTLED_MS ? `idle at its prompt for ${SETTLED_MS / 1000}s, without the done word` : undefined;
    },
    () => whatIsUp(handle),
  );
}

test('a Claude bot that follows the obk-bot-building skill reaches the CLI that launched its tab, and the machine\'s obk is not run', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };
  const machineBefore = machineObk();
  t.diagnostic(machineBefore === undefined
    ? 'no obk on this test\'s PATH: a bare obk would reach nothing, so that half shows nothing here'
    : `the machine's obk: ${machineBefore.at} -> ${machineBefore.real}, version ${machineBefore.version}`);

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-skill-cli-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', READER.name, TARGET].map(homeOf);
  const reader = homeOf(READER.name);
  const target = homeOf(TARGET);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (#426).
    const { closed, foreign } = guard.closeOwnAt(homes);
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id) || held.has(setup.path)) continue;
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

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    // The machine's obk, as it was.
    assert.deepEqual(machineObk(), machineBefore, 'the machine\'s obk is untouched');
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // 1. The fleet.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', READER.name, '--harness', 'claude',
    '--charter', `${READER.name} looks after this throwaway bots folder when asked, for one system test run.`,
  ]);
  obkJson(['bot', 'create', '--bots', bots, '--name', TARGET, '--harness', 'claude', '--charter', `${TARGET} exists for one system test run and owns nothing.`]);
  const readerYaml = path.join(reader, 'bot.yaml');
  const withSkill = (await readFile(readerYaml, 'utf8')).replace(/^skills: \[\]$/m, 'skills:\n  - kit:obk-bot-building');
  assert.match(withSkill, /- kit:obk-bot-building/, 'the premise: reader-bot\'s bot.yaml takes the skill');
  await writeFile(readerYaml, withSkill);
  obkJson(['skills', 'build', '--bots', bots, '--bot', READER.name]);
  assert.ok(existsSync(path.join(reader, '.claude', 'skills', 'obk-bot-building', 'SKILL.md')), 'the premise: the skill is linked in reader-bot\'s folder for Claude Code');
  obkJson(['session', 'add', '--bots', bots, '--bot', READER.name, '--name', 'daily', `--prompt=${startPrompt}`]);

  const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', READER.name]), 'daily');
  assert.equal(entry.created, true, 'the premise: up opened reader-bot\'s tab');
  const handle = entry.terminal;
  const id = await until(
    `${READER.title} to report its session id`,
    READY_MS,
    async () => (await sessionIn(reader, 'daily')).session,
    () => whatIsUp(handle),
  );
  await until(`the start turn to answer ${READY.toLowerCase()}`, ANSWER_MS, async () => (screenOf(handle).includes(READY.toLowerCase()) ? true : undefined), () => whatIsUp(handle));

  // The premise: the harness in the tab carries OBK_CLI naming this checkout's CLI.
  const front = await until(`claude to be in front of ${READER.title}`, READY_MS, async () => {
    const found = inFront(handle);
    return found?.name === 'claude' ? found : undefined;
  }, () => whatIsUp(handle));
  const words = environmentWords(front.pid);
  assert.ok(
    words.some((word) => word.startsWith('OBK_CLI=') && spellingsOf(cliEntry).some((cli) => word === `OBK_CLI=${cli}` || word === `OBK_CLI=${cliEntry}`)),
    `the premise: reader-bot's claude (pid ${front.pid}) carries OBK_CLI naming this checkout's CLI`,
  );

  // 2. The hand edit the skill describes.
  const targetYaml = path.join(target, 'bot.yaml');
  const edited = (await readFile(targetYaml, 'utf8')).replace(/^rules: \[\]$/m, `rules:\n  - kit:${UNIT}`);
  assert.match(edited, new RegExp(`- kit:${UNIT}`), `the premise: ${TARGET}'s bot.yaml takes the rule`);
  await writeFile(targetYaml, edited);
  const title = unitTitle();
  assert.ok(title, `the premise: rules/${UNIT}.md has a title`);
  const agentsFile = path.join(target, 'AGENTS.md');
  assert.ok(!readFileSync(agentsFile, 'utf8').includes(`## ${title}`), `the premise: ${TARGET}'s AGENTS.md does not carry ${UNIT} before the build`);

  // 3. The ask, typed at reader-bot's plain prompt.
  await atPrompt(handle);
  typeIntoClaude(handle, askFor(bots));
  t.diagnostic(`reader-bot's turn ended ${await turnOver(handle, reader, id)}`);

  // What it ran, as its own record has it.
  const commands = shellCommandsIn(linesOf(reader, id));
  for (const command of commands) t.diagnostic(`reader-bot ran: ${command}`);

  // A build ran after the edit, and this checkout's CLI is the one that wrote it.
  const agents = readFileSync(agentsFile, 'utf8');
  assert.ok(agents.includes(`## ${title}`), `${TARGET}'s AGENTS.md carries ${UNIT} after reader-bot's turn: a rules build ran. Commands: ${JSON.stringify(commands)}`);
  const mailLine = agents.split('\n').find((line) => / message to --bots /.test(line)) ?? '';
  assert.ok(
    spellingsOf(cliEntry).some((cli) => mailLine.includes(`${cli} message to --bots`)),
    `the build that wrote ${TARGET}'s AGENTS.md was this checkout's CLI: its mail line should name ${cliEntry}, got: ${mailLine}`,
  );
  if (machineBefore !== undefined) {
    assert.ok(
      ![machineBefore.at, machineBefore.real].some((one) => mailLine.includes(one)),
      `and not the machine's obk, got: ${mailLine}`,
    );
  }

  // And the machine's obk was not run: no command reached it.
  assert.deepEqual(commands.filter(startsBareObk), [], 'no command reader-bot ran starts a bare obk');
  if (machineBefore !== undefined) {
    assert.deepEqual(
      commands.filter((command) => [machineBefore.at, machineBefore.real].some((one) => codeOf(command).includes(one))),
      [],
      'and none names the machine\'s obk by its path',
    );
  }
});
