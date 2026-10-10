// A system test: a Claude session's native message to a session outside its
// bots folder is warned about, and one to a session of its own fleet is not
// (#451, the owner's choice of a warning only; the architect's ruling of
// 2026-10-02). Against the real Orca and real Claude Code on this machine. Run
// it with `npm run test:system -- --yes test/system/send-outside-fleet.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The kit's hook, `obk session sent`, runs after every SendMessage of a
// kit-launched Claude session (PostToolUse, matcher SendMessage, in the bot
// folder's .claude/settings.json beside SessionStart). When the message went to
// another session by a name that is in no book of the sender's bots folder, it
// hands the session a warning as context; it decides nothing.
//
// **Every message here stays inside this test's own throwaway fleets** (the
// ruling, point 3; #450 is why). Two throwaway bots folders, A and B, each made
// the usual `obk-system-…` way, so #240's runner cleans what Claude Code writes
// about them. Fleet B has one Claude bot, `receiver`, with one session. Fleet A
// has one Claude bot, `sender`, with two: `peer`, and `daily`. The only messages
// sent are the two `daily` is told to send in its start prompt: one to `peer`,
// a session of its own fleet, the control; and one to B's `receiver`, a session
// of another throwaway fleet, the case. From a throwaway session to a throwaway
// session, both times, and never to anything else on this machine. The two
// receivers are told not to answer.
//
// What it proves, read from `daily`'s own transcript:
//
//   1. `daily` called SendMessage to B's address (its book's `address`, made by
//      the kit, and in none of fleet A's books), and the call did not fail.
//   2. After that call's result, a line of the transcript carries the hook's
//      warning: its own words, "is not one of the sessions of your bots folder",
//      and B's address. Which kind of line Claude Code writes it as (an
//      attachment, a hook line, a system reminder) is not pinned; what was
//      found is printed when it is not there.
//   3. The control: `daily` called SendMessage to `peer`'s address too, the
//      call did not fail, and no line of the transcript says that message went
//      outside the fleet.
//   4. Where it went: every SendMessage `daily` made, answered or not, has a
//      `to` that, less a ` [xxxxxx]` ref, is `peer`'s address or B's, and no
//      other (#450, #220). It is checked after the others, whatever they found,
//      and before the teardown; the count is printed.
// Printed as diagnostics, never failed on: the commit of the checkout the test
// runs from (`git rev-parse HEAD`); the Claude Code version the transcript
// records; and, read from B's `receiver` and A's `peer` transcripts within
// DELIVERY_MS of the answered sends, whether a line holding its message's words
// arrived there, and which kind of line. A message to another session can wait
// for the receiver's next turn, and the receivers are told not to act, so a
// line not there yet says nothing against the send.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in throwaway bots folders under the system temp
// directory; writes down every terminal and workspace Orca already had; runs
// this checkout's `src/cli.js` by its full path, never the machine's `obk`
// (#220); closes only its own tabs, through the tab guard, and deletes its own
// workspaces, whatever happened.
//
// **It is attended, a little.** A bot folder nobody has opened before asks
// questions before the harness is running in it (PRD 6.5). This test answers
// one of them itself, Claude Code's folder trust, in its own throwaway Claude
// tabs alone: `Receiver daily`, `Sender peer`, and `Sender daily` if it shows
// the screen too, which it should not, sharing `peer`'s folder. The
// architect's ruling on #451
// (https://github.com/guwenqing/orca-bot-kit/issues/451#issuecomment-5961132572),
// the same exception as codex-groom-run's daily under #238: it answers only
// when the screen names that tab's own throwaway folder, the pointer is on "No,
// exit", "Yes, I trust this folder" is there, and no line pre-approves a
// permission (helpers/screens.js `plainTrustOf`, the check codex-groom-run
// runs), and only when every row from "Accessing workspace:" down is a row of
// the captured plain screen, its own folder in the folder's place, and nothing
// else (`onlyPlainTrustOf`). Then down and return, once for that tab, with no
// `--enter`. Any other screen gets no answer, and the test fails printing
// every row it saw; a hooks line, if one shows, goes to the architect before
// any rerun.
//
// The person still has these, which nothing here waits on: each fleet's `Bot
// Father daily` shows the same folder trust, and it can be left; and after a
// turn Claude Code may offer "Teach auto mode about your environment?", where
// Esc cancels it (#416). Nothing else is to be answered.
//
// It takes a few minutes: three Claude sessions, one of them sending two
// messages.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { addressPattern, cliEntry } from '../helpers/cli.js';
import { onlyPlainTrustOf, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove a throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts`, `<bots>.locks` and the rest are siblings of it (PRD 6.3).
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

/** How long a real agent is given to do something before the test gives up on it. */
const ANSWER_MS = 240000;

/** How long a tab is given to get past the screens of its own: a person may be answering one. */
const READY_MS = 180000;

/** How long the hook's warning is given to be written down after the send's result. */
const WARNING_MS = 60000;

/** How long each receiver's transcript is watched for the message that was sent to it. */
const DELIVERY_MS = 60000;

/** The hook's warning, in its own words (src/sent.js). */
const WARNING = 'is not one of the sessions of your bots folder';

/** What the two messages say. */
const OUTSIDE_TEXT = 'hello from the send-outside-fleet test';
const INSIDE_TEXT = 'hello from inside the fleet';

/** The part every session here but the sender is given: nothing, and no answer to a message. */
const QUIET = 'You are a system test\'s throwaway bot and you own nothing. Do not run any command, read or write'
  + ' any file, or use any tool, now or later. If a message comes to you, do not answer it. Say nothing now and wait.';

/** The sender's part: the two messages, the control first, and nothing else. */
const senderPrompt = ({ inside, outside }) => 'You are a system test\'s throwaway bot and you own nothing. Do exactly two'
  + ` things, in this order, and nothing else. First, send one message with your SendMessage tool to ${inside},`
  + ` saying '${INSIDE_TEXT}'. Then send one message with your SendMessage tool to ${outside}, saying`
  + ` '${OUTSIDE_TEXT}'. Then stop: use no other tool, and answer nothing that comes.`;

/** Every close goes through the guard, which counts it for the check at the end (#246). */
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

/** The tabs Orca lists at `home` once it has caught up with what was closed (#187). */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const stop = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < stop) {
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

/** Run this checkout's `obk`, by its full path (#217). */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json`, read the answer, and count every tab it says it opened as this test's own. */
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

/** One bot's book as it stands. */
const bookAt = (home) => parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};

/** What the book says about one session right now. */
const sessionIn = (home, name) => bookAt(home).sessions?.[name] ?? {};

/** Every address the books of a bots folder hold, its sessions' and its retired sessions'. */
function addressesIn(bots) {
  const dir = path.join(bots, 'bots');
  return readdirSync(dir).flatMap((bot) => {
    const file = path.join(dir, bot, 'sessions.yaml');
    if (!existsSync(file)) return [];
    const book = parse(readFileSync(file, 'utf8')) ?? {};
    return [
      ...Object.values(book.sessions ?? {}).map((entry) => entry?.address),
      ...(Array.isArray(book.retired) ? book.retired : []).map((entry) => entry?.address),
    ].filter((address) => typeof address === 'string');
  });
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

/** The rows the tab renders now, or undefined when Orca will not say. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const tail = answer.ok === true && answer.result?.terminal?.source === 'screen' ? answer.result.terminal.tail : undefined;
  return Array.isArray(tail) ? tail : undefined;
}

/** Everything the tab is rendering right now, as one piece of text. */
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

/** Wait until a tab will take a message: a TUI up, nothing of its own waiting (helpers/screens.js). */
async function readyForMail(handle, within = READY_MS) {
  await until(
    `${handle} to be past the screens of its own`,
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

/** Where Claude Code keeps the conversations it had in one folder (tech notes, section 2). */
const transcriptsOf = (home) => path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));

/** One conversation's transcript, whole lines only, a JSON object each. */
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

const itemsOf = (line, type) => (Array.isArray(line.message?.content) ? line.message.content.filter((item) => item?.type === type) : []);
const toolUses = (line) => (line.type === 'assistant' ? itemsOf(line, 'tool_use') : []);
const toolResults = (line) => (line.type === 'user' ? itemsOf(line, 'tool_result') : []);

/** A SendMessage `to` with any trailing ` [xxxxxx]` ref taken off. */
const nameOf = (to) => String(to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();

/**
 * The SendMessage calls in a transcript to `address`, each with the index of
 * the line holding its result and that result, once there is one.
 */
function sendsTo(lines, address) {
  const calls = lines.flatMap(toolUses).filter((use) => use.name === 'SendMessage' && nameOf(use.input?.to) === address);
  return calls.map((use) => {
    const at = lines.findIndex((line) => toolResults(line).some((result) => result.tool_use_id === use.id));
    return { use, at, result: at < 0 ? undefined : toolResults(lines[at]).find((result) => result.tool_use_id === use.id) };
  });
}

/**
 * Watch the receivers' transcripts, each `{ label, home, session, text }`, for
 * a line holding its `text`, for at most `within`; then say for each whether
 * one arrived, and as which kind of line. Diagnostics only: it fails nothing.
 */
async function deliveries(t, receivers, within = DELIVERY_MS) {
  const stop = Date.now() + within;
  const found = new Map();
  for (;;) {
    for (const one of receivers) {
      if (found.has(one)) continue;
      let hit;
      try {
        hit = linesOf(one.home, one.session).find((line) => JSON.stringify(line).includes(one.text));
      } catch {
        hit = undefined;
      }
      if (hit !== undefined) found.set(one, hit);
    }
    if (found.size === receivers.length || Date.now() >= stop) break;
    await setTimeout(1000);
  }
  for (const one of receivers) {
    const hit = found.get(one);
    t.diagnostic(hit === undefined
      ? `${one.label}: no line holding '${one.text}' in its transcript within ${within}ms (it may be queued for its next turn)`
      : `${one.label}: '${one.text}' arrived as a ${hit.type}${hit.subtype ? `/${hit.subtype}` : ''} line, at ${hit.timestamp ?? '(no timestamp)'}`);
  }
}

/** The commit of the checkout this test runs from, or why it could not be read. */
function commitRun() {
  const done = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: path.dirname(path.dirname(cliEntry)) });
  if (done.error !== undefined) return `(git did not run: ${done.error.message})`;
  return done.status === 0 ? done.stdout.trim() : `(git rev-parse HEAD failed: ${done.stderr.trim()})`;
}

/** The last lines of a stretch of transcript, short, for the message of a wait that ran out. */
function tailOf(lines, count = 15) {
  if (lines.length === 0) return '    (nothing)';
  return lines.slice(-count).map((line) => `    ${line.timestamp ?? '-'}  ${line.type}${line.subtype ? `/${line.subtype}` : ''}  ${JSON.stringify(line).slice(0, 300)}`).join('\n');
}

test('a Claude session\'s native message to a session of another bots folder is warned about, and one to its own fleet is not', async (t) => {
  t.diagnostic(`the commit this run ran: ${commitRun()}`);
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const botsA = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-send-outside-a-')));
  const botsB = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-send-outside-b-')));
  const sender = path.join(botsA, 'bots', 'sender');
  const receiver = path.join(botsB, 'bots', 'receiver');
  const homes = [path.join(botsA, 'bots', 'bot-father'), sender, path.join(botsB, 'bots', 'bot-father'), receiver];

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(homes);
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, setup.path.startsWith(`${botsA}/`) ? botsA : botsB);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects, ${botsA} and ${botsB} in place`);
    await removeBotsFolderAndSiblings(botsA);
    await removeBotsFolderAndSiblings(botsB);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  /** Bring one session up, wait until its harness has reported its conversation and its tab is past its screens, and give its address. */
  const live = async (bots, home, bot, session) => {
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot, '--session', session]), session);
    assert.equal(entry.created, true, `up opened ${bot} ${session}'s tab`);
    assert.equal(entry.harnessStarted, true, `no claude came up in ${entry.title}: \`orca terminal read --terminal ${entry.terminal} --screen\``);
    // Its folder trust, which this test answers itself, once, and only when it
    // is the plain one for this tab's own folder (the ruling on #451).
    const asked = await until(
      `${bot} ${session} to show Claude Code's folder trust, or report its conversation`,
      READY_MS,
      async () => {
        if (typeof sessionIn(home, session).session === 'string') return { rows: null };
        const rows = rowsOf(entry.terminal);
        return rows !== undefined && rows.some((row) => row.includes('Yes, I trust this folder')) ? { rows } : undefined;
      },
      () => whatIsUp(entry.terminal),
    );
    if (asked.rows !== null) {
      const wrong = onlyPlainTrustOf(asked.rows, home);
      assert.equal(
        wrong,
        undefined,
        `${entry.title}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.`
        + `\n  what it showed:\n    ${asked.rows.join('\n    ')}`,
      );
      const sent = orca(['terminal', 'send', '--terminal', entry.terminal, '--text', '\x1b[B\r']);
      assert.equal(sent.ok, true, `answering ${entry.title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
      t.diagnostic(`answered ${entry.title}'s plain folder trust (the ruling on #451)`);
    }
    await until(
      `${bot} ${session} to report its conversation`,
      READY_MS,
      async () => sessionIn(home, session).session,
      () => ` Its folder trust was answered, or never asked.${whatIsUp(entry.terminal)}`,
    );
    await readyForMail(entry.terminal);
    const address = sessionIn(home, session).address;
    assert.match(String(address), addressPattern(bot, session), `the kit gave ${bot} ${session} an address of its own: ${JSON.stringify(sessionIn(home, session))}`);
    return { entry, address };
  };

  // Fleet B: the receiver, live before anything is sent to it.
  obkJson(['init', '--bots', botsB, '--harness', 'claude']);
  obkJson(['bot', 'create', '--bots', botsB, '--name', 'receiver', '--harness', 'claude', '--charter', 'Receiver exists for one system test run and owns nothing.']);
  obkJson(['session', 'add', '--bots', botsB, '--bot', 'receiver', '--name', 'daily', `--prompt=${QUIET}`]);
  const outside = (await live(botsB, receiver, 'receiver', 'daily')).address;

  // Fleet A: the peer first, live before the sender is told to write to it.
  obkJson(['init', '--bots', botsA, '--harness', 'claude']);
  obkJson(['bot', 'create', '--bots', botsA, '--name', 'sender', '--harness', 'claude', '--charter', 'Sender exists for one system test run and owns nothing.']);
  obkJson(['session', 'add', '--bots', botsA, '--bot', 'sender', '--name', 'peer', `--prompt=${QUIET}`]);
  const inside = (await live(botsA, sender, 'sender', 'peer')).address;

  // The premise: B's address is in none of fleet A's books, and A's peer's is.
  assert.ok(!addressesIn(botsA).includes(outside), `${outside} is fleet B's, and in none of fleet A's books: ${JSON.stringify(addressesIn(botsA))}`);
  assert.ok(addressesIn(botsA).includes(inside), `${inside} is fleet A's own`);

  // The sender, whose start prompt holds the two messages and nothing else.
  obkJson(['session', 'add', '--bots', botsA, '--bot', 'sender', '--name', 'daily', `--prompt=${senderPrompt({ inside, outside })}`]);
  const lines = () => linesOf(sender, sessionIn(sender, 'daily').session);

  // Everything from the sender's start to the warning, kept so the
  // where-it-went check below runs whatever it found.
  let failure;
  try {
    const { entry: daily } = await live(botsA, sender, 'sender', 'daily');

    // Both messages sent, and both answered.
    const [toOutside, toInside] = await until(
      'the sender to send its two messages and have both answered',
      ANSWER_MS,
      async () => {
        const now = lines();
        const out = sendsTo(now, outside)[0];
        const ins = sendsTo(now, inside)[0];
        return out?.result !== undefined && ins?.result !== undefined ? [out, ins] : undefined;
      },
      () => `\n  the sender's conversation:\n${tailOf(lines())}${whatIsUp(daily.terminal)}`,
    );
    const version = lines().map((line) => line.version).find((one) => typeof one === 'string');
    t.diagnostic(`Claude Code version the sender's transcript records: ${version ?? '(none recorded)'}`);
    // On the receivers' side: did each message arrive? Printed, never failed on.
    await deliveries(t, [
      { label: `B's receiver daily (${outside})`, home: receiver, session: sessionIn(receiver, 'daily').session, text: OUTSIDE_TEXT },
      { label: `A's sender peer (${inside}), the control`, home: sender, session: sessionIn(sender, 'peer').session, text: INSIDE_TEXT },
    ]);
    assert.notEqual(toOutside.result.is_error, true, `the message to ${outside} did not fail: ${JSON.stringify(toOutside.result)}`);
    assert.notEqual(toInside.result.is_error, true, `the message to ${inside} did not fail: ${JSON.stringify(toInside.result)}`);

    // 2. The warning, after the outside send's result: its own words and B's address.
    const warned = await until(
      `the hook's warning about ${outside} to reach the sender's conversation`,
      WARNING_MS,
      async () => {
        const now = lines();
        const at = sendsTo(now, outside)[0]?.at ?? -1;
        return now.slice(at + 1).find((line) => {
          const said = JSON.stringify(line);
          return said.includes(WARNING) && said.includes(outside);
        });
      },
      () => `\n  the sender's conversation after the result of its message to ${outside}:\n${tailOf(lines().slice((sendsTo(lines(), outside)[0]?.at ?? -1) + 1), 30)}`,
    );
    t.diagnostic(`the warning reached the sender as a ${warned.type}${warned.subtype ? `/${warned.subtype}` : ''} line`);

    // 3. The control: nothing says the message to the fleet's own peer went outside.
    const aboutInside = lines().filter((line) => {
      const said = JSON.stringify(line);
      return said.includes(WARNING) && said.includes(inside);
    });
    assert.deepEqual(aboutInside, [], `no warning about ${inside}, a session of the sender's own fleet:\n${tailOf(aboutInside)}`);
  } catch (error) {
    failure = error;
  }

  // 4. Where it went: every SendMessage the sender made, answered or not, went
  // to peer's address or B's, and to no other session on this machine (#450,
  // #220). A name Claude Code lists may carry a ` [xxxxxx]` after it; the name
  // is what counts.
  const sends = lines().flatMap(toolUses).filter((use) => use.name === 'SendMessage');
  const elsewhere = sends.map((use) => String(use.input?.to ?? '')).filter((to) => nameOf(to) !== inside && nameOf(to) !== outside);
  t.diagnostic(`the sender's messages by Claude Code's own messaging: ${sends.length}, ${elsewhere.length} of them to somewhere other than ${inside} or ${outside}`);
  if (elsewhere.length > 0 && failure !== undefined) t.diagnostic(`the check before it also failed: ${failure.message}`);
  assert.deepEqual(
    elsewhere,
    [],
    `the sender sent by Claude Code's own messaging to somewhere other than this test's peer, ${inside}, or B's receiver, ${outside}: `
    + 'a test reached outside its own fleets (#450, #220)',
  );
  if (failure !== undefined) throw failure;
});
