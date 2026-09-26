// A system test: a session still under the old shared name moves to an address
// of its own when the kit restarts it (#319), against the real Claude Code in
// the real Orca on this machine. Run it with `npm run test:system`; `npm test`
// cannot, and no CI machine could.
//
// Before #286 every Claude session the kit started was named `<bot>.<session>`,
// and every fleet's session of that name answered to it, so a native send to it
// was refused. Since #286 a fresh conversation gets `<bot>.<session>.<token>`.
// A conversation still under the bare name is moved when the kit's own launch
// line next resumes it: the line carries `-n` with a new address, and the book
// records it. The owner proved live that `claude --resume <id> -n <new>` reopens
// the same conversation under the new name. What only a live run can show is
// that the kit's restart does exactly that to a session that really is under
// the old name, and that the fleet then reaches it:
//
//   1. The same conversation is running after the restart, in a new process.
//   2. That process is registered under the address the book now holds
//      (`~/.claude/sessions/<pid>.json`, `name`; tech notes, section 2).
//   3. `obk message to` answers `native` with that address, where it answered
//      the mailbox before the restart.
//   4. A native send to that address, made once by another Claude session of
//      the same approval class, reaches the conversation.
//
// The old name is given for real, not only written in the book: the session is
// brought up by the kit, ended with `/exit`, and started again in its own tab
// with `claude --resume <id> -n <bot>.<session>`, which is how a session from
// before #286 was launched. Its process record is read to see that it took.
// That line is this test's own, typed into this test's own tab.
//
// The receipt for 4 is the receiving conversation's own transcript, never a
// screen: the word sent is in the question typed into the *sending* tab, and
// nowhere the receiver has seen, so it can only reach the receiver's transcript
// by being delivered. "On the first try" is read out of the sender's transcript:
// exactly one tool call of its carries that word, so the one send it made is the
// one that arrived. Not checked: Claude Code's peer listing, which this test has
// no way to read; and whether the old name still reaches the conversation.
//
// The machine it runs on is someone's working machine, with their own tabs open.
// So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces;
//   - checks afterwards that every terminal that was there before is still there;
//   - signals no process: a process is only ever looked at, with `ps -p <pid>`,
//     one pid at a time, and a harness is ended with `/exit` or with its tab.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// It leaves behind what every Claude system test does: offline entries in the
// Remote Control list, here under `rename-claude.daily` and the addresses the
// kit gave, and the Run mailboxes Orca cannot delete.
//
// It is slow: two real agents, a relaunch by hand and a restart. Minutes.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them —
// answering them is the caller's job and not the kit's (PRD 6.5). What to expect:
//
//   1. `Rename Claude daily` and `Rename Claude sender`: Claude Code's
//      folder-trust list, once for the folder. Its selection starts on
//      `No, exit`, so it takes a down-arrow and then return.
//   2. Either tab, if Claude Code offers an update: accept it (PRD 6.5).
//   3. The sender may ask before it uses its messaging tool: allow it.
//   4. `Bot Father daily` will be sitting on its own trust question. Leave it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse, stringify } from 'yaml';

import { addressPattern, cliEntry } from '../helpers/cli.js';
import { waitingOn } from '../helpers/screens.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts`, `<bots>.locks` and the rest are siblings of the bots folder,
 * not children of it (PRD 6.3).
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

/** How long a real agent is given to answer a question before the test gives up on it. */
const ANSWER_MS = 240000;

/** How long the kit's hook is given to have written the book after a session starts. */
const HOOK_MS = 60000;

/** How long a tab is given to be ready for a question, a person answering its screens included. */
const READY_MS = 180000;

/** How long a native message is given to reach the receiving conversation. */
const DELIVERY_MS = 240000;

/** Ask Orca something and read its JSON. Never the blanket close, on any road. */
function orca(args) {
  assert.ok(
    !(args.includes('--all') && args.includes('close')),
    `refusing to run \`orca ${args.join(' ')}\`: it would take away someone else's tabs`,
  );
  const done = spawnSync(ORCA, [...args, '--json'], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.message}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`orca ${args.join(' ')} did not answer JSON: ${done.stdout}${done.stderr}`);
  }
  return answer;
}

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
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return JSON.parse(done.stdout);
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

/** The book's file for a bot's home. */
const bookAt = (home) => path.join(home, 'sessions.yaml');

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(bookAt(home), 'utf8')) ?? {};
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

/**
 * Wait until the tab will take a question: a TUI is up and nothing of its own
 * is waiting to be answered, by Orca's word or by the screen itself (#329).
 */
async function readyForAQuestion(handle, within = READY_MS) {
  await until(
    `${handle} to be past the questions of its own`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true) return undefined;
      if (answer.result?.wait?.blockedReason !== undefined) return undefined;
      return waitingOn(orca, handle) === undefined ? true : undefined;
    },
    () => `${waitingOn(orca, handle) ?? ''}${whatIsUp(handle)}`,
  );
}

/** The request id an `agent_prompt_blocked` carries, read out of the whole error. */
function requestIdIn(error) {
  const found = /"orchestrationRequestId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(error ?? null));
  return found === null ? undefined : found[1];
}

/**
 * Send one line into this test's own tab, with `--enter`, whatever is in front
 * of it. A gated line fails with the screen and the id rather than retrying
 * (see `session-identity.test.js`).
 */
function sendLine(handle, text) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  if (sent.ok === true) return;

  const gated = requestIdIn(sent.error);
  assert.fail(
    `orca terminal send --enter failed: ${JSON.stringify(sent.error)}.`
    + (gated === undefined
      ? ''
      : ' Orca gated it as an agent prompt. Submit the line yourself in the tab, or reissue the'
        + ` same command with --retry-request ${gated} --wait-submit 30.`)
    + whatIsUp(handle),
  );
}

/** Type a line into this test's own tab once it is ready to take one. */
async function askIn(handle, text) {
  await readyForAQuestion(handle);
  sendLine(handle, text);
}

/**
 * Ask the session something and wait for `word` to appear on its screen. Only a
 * word that is neither in the question nor on the screen already can be waited
 * for: the echo of the typed line would satisfy the first, and whatever was
 * already there the second, with no agent reading anything.
 */
async function answers(handle, question, word, within = ANSWER_MS) {
  assert.ok(!question.includes(word), `${word} is in the question itself, so its echo would answer it: ${question}`);
  assert.ok(
    !screenOf(handle).includes(word),
    `${word} is on the screen before anyone asked for it, so an answer would prove nothing: ${question}`,
  );
  await askIn(handle, question);
  await until(
    `${handle} to answer with ${word}`,
    within,
    async () => (screenOf(handle).includes(word) ? true : undefined),
    () => whatIsUp(handle),
  );
}

/** Claude Code's registry of running processes, one file each, `<pid>.json` (tech notes, section 2). */
const REGISTRY = path.join(os.homedir(), '.claude', 'sessions');

/** Every entry in the registry, read as it is; one being written or removed as it is read is left out. */
function registry() {
  let names;
  try {
    names = readdirSync(REGISTRY);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names.filter((one) => one.endsWith('.json'))) {
    try {
      entries.push(JSON.parse(readFileSync(path.join(REGISTRY, name), 'utf8')));
    } catch {
      // The next look reads it again.
    }
  }
  return entries.filter((entry) => entry !== null && typeof entry === 'object');
}

/**
 * The registry's entries for conversation `id` whose process is still there. A
 * file left by a process that was killed with its tab is not one, which is why
 * the process is looked at as well. That look is `ps -p`, which only reads.
 */
function processesIn(id) {
  return registry()
    .filter((entry) => entry.sessionId === id && Number.isInteger(entry.pid) && entry.pid > 0)
    .filter((entry) => spawnSync('ps', ['-p', String(entry.pid), '-o', 'pid='], { encoding: 'utf8' }).status === 0);
}

/** The registry's entries for one folder, short, for the message of a wait that ran out. */
const registryAt = (home) => JSON.stringify(registry()
  .filter((entry) => entry.cwd === home)
  .map((entry) => ({ pid: entry.pid, sessionId: entry.sessionId, name: entry.name })));

/** Where Claude Code keeps the conversations of one folder. */
const transcriptsOf = (home) => path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));

/** One conversation's transcript, a JSON object per whole line; a conversation with no file yet has none. */
function linesOf(home, id) {
  if (typeof id !== 'string') return [];
  const file = path.join(transcriptsOf(home), `${id}.jsonl`);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const lines = [];
  for (const raw of text.slice(0, text.lastIndexOf('\n') + 1).split('\n')) {
    if (raw.trim() === '') continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // Not a line Claude Code finished writing as JSON; nothing here reads it.
    }
  }
  return lines;
}

/** The text a line says, where it says it as text: not a tool's answer. */
function textsOf(line) {
  const content = line.message?.content;
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((item) => item?.type === 'text' && typeof item.text === 'string').map((item) => item.text);
}

/** The tool calls an assistant line makes, and the tool answers a user line carries. */
const itemsOf = (line, type) => (Array.isArray(line.message?.content) ? line.message.content.filter((item) => item?.type === type) : []);
const toolUses = (line) => (line.type === 'assistant' ? itemsOf(line, 'tool_use') : []);
const toolResults = (line) => (line.type === 'user' ? itemsOf(line, 'tool_result') : []);

/** What a message by Claude Code's own messaging arrives wrapped in (seen live, `groom.test.js`). */
const CROSS_SESSION = '<cross-session-message';

/** The bot: two sessions, one that is moved and one that writes to it. */
const BOT = {
  name: 'rename-claude',
  display: 'Rename Claude',
  codeword: 'OSPREY-7294',
  word: 'HERON-5530',
};

const START_PROMPT = [
  `You are a system test's bot and you own nothing. Your codeword is ${BOT.codeword}.`,
  'When anyone asks you for your codeword, give it in exactly the form they ask for, and nothing else.',
  'Do not run any command, do not read or write any file, and do not use any tool.',
  'Say nothing now and wait.',
].join(' ');

const SENDER_PROMPT = [
  'You are a system test\'s bot and you own nothing.',
  'When you are asked to send a message to another Claude session, send it with Claude Code\'s own',
  'cross-session messaging, exactly once, to exactly the name you are given, and do not retry.',
  'Do not run any command and do not read or write any file.',
  'Say nothing now and wait.',
].join(' ');

test('a session under the old shared name is moved to an address of its own by a restart, and reached there natively', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-old-name-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);
  const bare = `${BOT.name}.daily`;

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const closed = [];
    for (const each of homes) {
      for (const terminal of terminalsAt(each)) {
        if (before.handles.has(terminal.handle)) continue;
        orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
        closed.push(terminal.handle);
      }
    }
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    await removeBotsFolderAndSiblings(bots);

    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude',
    '--charter', `${BOT.display} exists for one system test run and owns nothing.`,
  ]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily', `--prompt=${START_PROMPT}`]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'sender', `--prompt=${SENDER_PROMPT}`]);

  const opened = obkJson(['up', '--bots', bots, '--bot', BOT.name]);
  const daily = tabOf(opened, 'daily');
  const sender = tabOf(opened, 'sender');
  for (const entry of [daily, sender]) {
    assert.equal(
      entry.harnessStarted,
      true,
      `no claude came up in ${entry.title}: look at it with \`orca terminal read --terminal ${entry.terminal} --screen\``,
    );
  }

  // The hook's report is what says the folder trust was answered and the
  // harness is running; the id is what the restart hands back.
  const id = await until(
    `${BOT.name}/daily to report its session id`,
    HOOK_MS,
    async () => (await sessionIn(home, 'daily')).session,
    () => ` The kit's hook has not run.${whatIsUp(daily.terminal)}`,
  );
  await until(
    `${BOT.name}/sender to report its session id`,
    HOOK_MS,
    async () => (await sessionIn(home, 'sender')).session,
    () => ` The kit's hook has not run.${whatIsUp(sender.terminal)}`,
  );
  const first = await sessionIn(home, 'daily');
  assert.match(String(first.address), addressPattern(BOT.name, 'daily'), `the kit started it under an address of its own: ${JSON.stringify(first)}`);

  // One turn, so the conversation is on Claude Code's own record and a resume
  // has something to pick up (#295).
  await answers(daily.terminal, 'Reply with your codeword in lower case and nothing else.', BOT.codeword.toLowerCase());

  // ---------------------------------------------------------------------------
  // Give the conversation the old shared name, for real. The kit's harness is
  // ended with /exit, the book is set back to what a book from before #286
  // holds, and the conversation is started again in the same tab the way the
  // kit started it then: under `<bot>.<session>`.
  const kits = processesIn(id);
  assert.equal(kits.length, 1, `the premise: one running Claude Code is having ${id}, got ${registryAt(home)}`);
  await askIn(daily.terminal, '/exit');
  await until(
    `the Claude Code the kit started (pid ${kits[0].pid}) to exit, so the shell is in front`,
    ANSWER_MS,
    async () => (processesIn(id).length === 0 ? true : undefined),
    () => whatIsUp(daily.terminal),
  );

  const book = parse(await readFile(bookAt(home), 'utf8'));
  book.sessions.daily.address = bare;
  await writeFile(bookAt(home), stringify(book));

  sendLine(daily.terminal, `claude --resume ${id} -n ${bare}`);
  const old = await until(
    `a Claude Code under ${bare} to be having ${id}`,
    READY_MS,
    async () => processesIn(id).find((entry) => entry.name === bare),
    () => ` The registry for this folder: ${registryAt(home)}.${whatIsUp(daily.terminal)}`,
  );

  // Before the restart the book holds the shared name, which is no address,
  // so the fleet is told the mailbox.
  const beforeRestart = obkJson(['message', 'to', '--bots', bots, '--to', `${BOT.name}/daily`, '--from', `${BOT.name}/sender`]);
  assert.equal(beforeRestart.transport, 'orca', `under the old name it is reached through its mailbox: ${JSON.stringify(beforeRestart)}`);

  // ---------------------------------------------------------------------------
  // The restart. The kit closes that tab — the harness under the old name goes
  // with it — and resumes the conversation in a new one, on its own line.
  const answer = obkJson(['restart', '--bots', bots, '--bot', BOT.name, '--session', 'daily']);

  const back = tabOf(answer, 'daily');
  assert.equal(back.created, true, `a new tab was opened for it: ${JSON.stringify(back)}`);
  assert.equal(back.resumed, true, 'and the run says it picked the conversation up again');
  assert.equal(
    back.harnessStarted,
    true,
    `no claude came up in ${back.title}: look at it with \`orca terminal read --terminal ${back.terminal} --screen\``,
  );

  const moved = await sessionIn(home, 'daily');
  assert.equal(moved.session, id, `the book still holds the same conversation: ${JSON.stringify(moved)}`);
  assert.match(String(moved.address), addressPattern(BOT.name, 'daily'), `and an address of the kit's kind: ${JSON.stringify(moved)}`);
  assert.notEqual(moved.address, first.address, 'a new one, not the one it had before it was given the old name');

  // 1 and 2: the same conversation, in a new process, registered under the
  // address the book holds.
  const running = await until(
    `a new Claude Code to be having ${id}`,
    READY_MS,
    async () => processesIn(id).find((entry) => entry.pid !== old.pid),
    () => ` The registry for this folder: ${registryAt(home)}.${whatIsUp(back.terminal)}`,
  );
  await until(
    `the Claude Code having ${id} (pid ${running.pid}) to be registered as ${moved.address}`,
    HOOK_MS,
    async () => (processesIn(id).find((entry) => entry.pid === running.pid)?.name === moved.address ? true : undefined),
    () => ` The registry for this folder: ${registryAt(home)}`,
  );
  // And the harness under the old name went with its tab: one process is
  // having the conversation. Waited for, because a process dies a moment after
  // Orca answers the close.
  await until(
    `the Claude Code under ${bare} (pid ${old.pid}) to be gone with its tab`,
    HOOK_MS,
    async () => {
      const pids = processesIn(id).map((entry) => entry.pid);
      return pids.length === 1 && pids[0] === running.pid ? true : undefined;
    },
    () => ` The registry for this folder: ${registryAt(home)}`,
  );

  // 3: the fleet is told the new address.
  const to = obkJson(['message', 'to', '--bots', bots, '--to', `${BOT.name}/daily`, '--from', `${BOT.name}/sender`]);
  assert.deepEqual(
    { transport: to.transport, address: to.address },
    { transport: 'native', address: moved.address },
    `a sender in the same approval class is told the native road, at the new address: ${JSON.stringify(to)}`,
  );

  // 4: a native send there, once, reaches the conversation. The word is in the
  // question to the sender and nowhere the receiver has been, so only a
  // delivery can put it in the receiver's transcript.
  const senderAddress = (await sessionIn(home, 'sender')).address;
  const senderId = (await sessionIn(home, 'sender')).session;
  assert.equal(
    linesOf(home, id).some((line) => JSON.stringify(line).includes(BOT.word)),
    false,
    `the premise: ${BOT.word} is nowhere in the receiving conversation yet`,
  );
  await askIn(
    sender.terminal,
    `Send one message to the Claude session named ${to.address}. The message is exactly: ${BOT.word}`,
  );
  const delivered = await until(
    `${BOT.word} to reach the conversation ${id} by Claude Code's own messaging`,
    DELIVERY_MS,
    async () => {
      const found = linesOf(home, id).filter((line) => line.type === 'user'
        && textsOf(line).some((text) => text.includes(CROSS_SESSION) && text.includes(BOT.word)));
      return found.length === 0 ? undefined : found;
    },
    () => `${whatIsUp(sender.terminal)}${whatIsUp(back.terminal)}`,
  );
  assert.equal(delivered.length, 1, `it arrived once: ${JSON.stringify(delivered)}`);
  assert.ok(
    textsOf(delivered[0]).some((text) => text.includes(`from-name="${senderAddress}"`)),
    `and it came from the sender, ${senderAddress}: ${JSON.stringify(delivered[0])}`,
  );
  // On the first try: the sender's calls carrying the word, counted once its
  // turn is over. Claude Code writes a transcript line some time after the
  // moment its timestamp gives, and the receiver's line can be on disk before
  // the sender's call is (seen live: the call was there, a few seconds late).
  // So first the call's answer is waited for, which is written after the call,
  // and then the tab going idle, which is the turn having ended with no call
  // after it.
  const sendsIn = () => linesOf(home, senderId).flatMap(toolUses).filter((use) => JSON.stringify(use.input ?? null).includes(BOT.word));
  await until(
    `the sender's call carrying ${BOT.word} and its answer to be in its transcript`,
    DELIVERY_MS,
    async () => {
      const calls = new Set(sendsIn().map((use) => use.id));
      const answered = linesOf(home, senderId).flatMap(toolResults).some((result) => calls.has(result.tool_use_id));
      return answered ? true : undefined;
    },
    () => whatIsUp(sender.terminal),
  );
  await readyForAQuestion(sender.terminal);
  const sends = sendsIn();
  assert.equal(sends.length, 1, `on the first try: the sender made one call carrying ${BOT.word}, got ${JSON.stringify(sends)}`);
});
