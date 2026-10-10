// A system test, and an observation: the Codex rows of the first-run screen
// table, proven again against the Codex this machine runs (#423). Against the
// real Codex in the real Orca. Run it alone with
// `npm run test:system -- --yes test/system/codex-first-run-screens.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The table is in SETUP.md step 5 and in skills/obk-bot-building/SKILL.md, and
// each row names the key to send for one screen and the version it was proven
// on (#335). Every Codex row says 0.157.1 or older; this machine now runs
// 0.158.0. The rows, as the table has them:
//
//   directory trust, `Trust this folder?`   `\r`         selection starts on
//                                                        Trust and continue
//   `Hooks need review`                     `\x1b[B\r`   down to Trust all and
//                                                        continue, then return;
//                                                        return alone if the
//                                                        selection starts there
//   `/new`: `Where should the new           `\r`         selection starts on
//   conversation run?`                                   Current checkout
//   the update offer, `1. Update now`       `\r`         selection starts on
//                                                        Update now
//
// Unlike the other system tests, this one answers the screens itself, in its
// own tab, with exactly the table's keys, because the keys are what is being
// proven. For each Codex screen that appears it records the rendered rows,
// reads where the selection starts, sends the table's key (each key a send of
// its own, and a return a send of its own, as harness-question.test.js's
// pressIn does, with a second between), and records what the screen moved on
// to. Before a return it reads the screen again, and it sends the return only
// when the selection is on the choice the table says it takes; otherwise it
// sends nothing more and stops, with the screen, since a return then would take
// whatever is highlighted.
//
// Except the update offer. The table's key there is a return on Update now,
// which would update this machine's Codex. So the test never sends it: if the
// offer appears it records its text and where the selection starts, sends Esc
// ("esc skip", its foot row, seen on 0.157.1 and in #226's run on 0.158.0's
// offer), and records what followed. 0.158.0 is likely the newest release, so
// the offer probably does not appear; the table says whether it did.
//
// The outcome each row's "Which is" column promises, and how it is read:
//
//   trust     the question goes, and Codex is still in front of the tab (it did
//             not quit, which is what the other choice does)
//   hooks     the question goes, Codex is still in front, and the kit's own hook
//             runs: the book learns the conversation's id (Trust all and
//             continue; the other choices leave the hook unrun)
//   /new      the menu goes, Codex is still in front, and the bots folder's git
//             repository has no worktree it did not have (Current checkout; the
//             other choice makes one)
//   update    (Esc) the offer goes, Codex is still in front, and `codex
//             --version` says what it said before
//
// `/new` is brought up by the test: once the session is idle, `/new` and then a
// return go in, only while the suite's shared screen look (helpers/screens.js,
// `waitingOn`) finds no question up. Codex refuses `/new` while a turn is
// running ("'/new' is disabled while a task is in progress", seen on 0.157.1),
// so on that answer it waits and tries again. If the menu does not come and
// that answer is not there, the menu is recorded as not appearing: `/new` is
// not typed twice into a conversation it may already have started.
//
// It prints one table at the end, pass or fail: screen, appeared, where the
// selection started, the key sent, the outcome as seen, and whether that
// matches the table. It asserts only its premises (the fleet, the tab, getting
// past each screen, a screen it recognises) and its cleanup, not the table, so
// what it sees can correct the table.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory, new to
//     Codex, so Codex has never trusted it;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types only into its own Codex tab, and never into Bot Father's;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces, whatever happened, and checks afterwards that
//     it closed no tab it did not create;
//   - signals no process; `ps` is read one pid at a time.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all.
//
// What it leaves behind is Codex's own doing, as every attended run before it
// did: answering the trust and hooks screens makes Codex write the throwaway
// folder's trust and the hooks' hashes into ~/.codex/config.toml, which the
// runner takes out again after the run (#240). The test never writes there
// itself.
//
// Its Codex is launched with `-c tui.show_tooltips=false` and none of the
// other arguments the other system tests take from codexTrustArgs: not the
// folder trust or the hooks bypass, since meeting and answering those screens
// is what it is for, and not the sleep-tool switch. With tooltips on, Codex
// 0.160.0 counts each showing of its new-model notice in the user's
// config.toml, `[tui.model_availability_nux]` (read in its source,
// tui/src/app/startup_prompts.rs); a run of this test added such a key (#456,
// the architect's ruling (a)).
//
// **It is attended, lightly.** The bots folder is `<tmp>/obk-system-codex-screens-*`
// and the bot's project shows in Orca as `Screens Codex · temp fleet
// obk-system-codex-screens-…`. The Codex tab, `Screens Codex daily`, is the
// test's to answer: leave it alone. `Bot Father daily` shows Claude Code's
// folder trust; nothing here waits on it, so leave that too. A screen in the
// Codex tab that the test does not recognise stops the test with the screen,
// and nothing is typed into it.
//
// It takes two or three minutes: one harness, its first-run screens, one start
// prompt and one `/new`.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { questionOn, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts` and the rest are siblings of the bots folder, not children
 * of it (PRD 6.3).
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

/** How long the tab is given to show its next screen, or to be idle. */
const READY_MS = 180000;

/** How long a real agent is given for its turn, and the kit's hook to report it. */
const ANSWER_MS = 240000;

/** How long a screen is given to move on after its key. */
const MOVE_MS = 30000;

/** How long the tab is given to take a key before the next one (harness-question.test.js). */
const KEY_GAP_MS = 1000;

/** How long one `/new` is given to bring its menu up. */
const MENU_MS = 10000;

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

/** The rows the tab renders right now, or undefined when Orca gives no rendered screen. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  return shown?.source === 'screen' && Array.isArray(shown.tail) ? shown.tail : undefined;
}

/** The rows as one piece of text, for a message. */
const shownIn = (handle) => (rowsOf(handle) ?? ['(no rendered screen)']).join('\n  ');

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  orca terminal read --terminal ${handle} --screen\n  ${shownIn(handle)}`;
}

/** Send keys into the test's own tab exactly as given, with no `--enter`. */
function sendKeys(handle, keys) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', keys]);
  assert.equal(sent.ok, true, `sending ${JSON.stringify(keys)} into ${handle} failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
}

/** Read `ps` for one pid, and nothing else: it is a reader here and never a road to a signal. */
function psOf(pid, columns) {
  assert.match(String(pid), /^[1-9]\d*$/, `ps is asked about one positive pid, got: ${pid}`);
  const done = spawnSync('ps', [...columns, '-p', String(pid)], { encoding: 'utf8' });
  return done.status === 0 ? done.stdout.trim() : undefined;
}

/** The name of the process in front of a tab's terminal, the way the kit finds it (restored-tab.test.js). */
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
  return comm === undefined ? undefined : path.basename(comm.replace(/^-/, ''));
}

/** What `codex --version` says: read, to see the update offer was not taken. */
const codexVersion = () => spawnSync('codex', ['--version'], { encoding: 'utf8', cwd: os.tmpdir(), timeout: 30000 }).stdout?.trim() ?? '';

/** How many worktrees the bots folder's git repository has: read, to see `/new` made none. */
function worktreesOf(bots) {
  const done = spawnSync('git', ['-C', bots, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  return done.status === 0 ? done.stdout.split('\n').filter((line) => line.startsWith('worktree ')).length : undefined;
}

// ------------------------------------------------------------- the screens

/** The four Codex screens, each known by the choices it offers, and what the table says of it. */
const SCREENS = {
  trust: {
    name: 'directory trust',
    choices: /\b(?:Trust and continue|Yes, continue)\b/,
    starts: /^(?:Trust and continue|Yes, continue)\b/,
    takes: /^(?:Trust and continue|Yes, continue)\b/,
    table: '`\\r`',
  },
  hooks: {
    name: 'Hooks need review',
    choices: /\bTrust all and continue\b|\bReview hooks\b/,
    // Down to Trust all and continue, or return alone if it starts there.
    starts: /^(?:Review hooks|Trust all and continue)\b/,
    takes: /^Trust all and continue\b/,
    table: '`\\x1b[B\\r`',
  },
  new: {
    name: '/new: Where should the new conversation run?',
    choices: /\bCurrent checkout\b|\bNew worktree\b/,
    starts: /^Current checkout\b/,
    takes: /^Current checkout\b/,
    table: '`\\r`',
  },
  update: {
    name: 'update offer',
    choices: /\bUpdate now\b/,
    starts: /^Update now\b/,
    takes: null,
    table: '`\\r` (not sent: it updates the machine)',
  },
};

/** Which of the four the question on screen is, by its choices, or null for a question the test does not know. */
const kindOf = (question) => Object.keys(SCREENS).find((kind) => question.some((row) => SCREENS[kind].choices.test(row))) ?? null;

/** The question up in the tab now, as its rows, or undefined when none is up (the suite's shared look). */
function questionIn(handle) {
  const rows = rowsOf(handle);
  return rows === undefined ? undefined : questionOn(rows);
}

/** The choice the selection is on: the label of the lowest `›` row that starts a numbered choice. */
function selectionIn(question) {
  const row = question.findLast((one) => /^\s*›\s*\d+\.\s+\S/.test(one));
  return row === undefined ? undefined : row.replace(/^\s*›\s*\d+\.\s+/, '').split(/\s{2,}/)[0].trim();
}

/** The keys as the table writes them. */
const written = (keys) => keys.map((key) => key.replaceAll('\r', '\\r').replaceAll('\x1b', '\\x1b')).join(' then ');

const BOT = { name: 'screens-codex', title: 'Screens Codex daily' };

test('the Codex rows of the first-run screen table, pressed live with the table\'s own keys (observed, not judged)', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };
  const version = codexVersion();
  t.diagnostic(`codex --version: ${version}`);

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-codex-screens-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);

  /** One record per screen: what appeared, where it started, what was sent, what followed. */
  const seen = Object.fromEntries(Object.keys(SCREENS).map((kind) => [kind, { appeared: false }]));

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    t.diagnostic('screen | appeared | selection starts on | key sent | outcome as seen | matches the table');
    for (const [kind, record] of Object.entries(seen)) {
      const row = SCREENS[kind];
      t.diagnostic([
        row.name,
        record.appeared ? 'yes' : 'no',
        record.start ?? '-',
        record.sent ?? '-',
        record.outcome ?? '-',
        record.appeared ? (record.matches ? 'yes' : 'no') : 'not seen',
      ].join(' | '));
    }

    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (review of PR #425).
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
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'codex',
    '--charter', `${BOT.name} exists for one system test run and owns nothing.`,
  ]);
  obkJson([
    'session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily',
    '--prompt=You are a system test\'s bot and you own nothing. Do not run any command, read or write'
    + ' any file, or use any tool. Say nothing now and wait.',
    // Tooltips off, and nothing else of codexTrustArgs (see the header, #456).
    '--extra-arg=-c', '--extra-arg=tui.show_tooltips=false',
  ]);
  const worktreesBefore = worktreesOf(bots);

  const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name]), 'daily');
  assert.equal(entry.created, true, 'the premise: up opened the Codex tab');
  const handle = entry.terminal;

  /**
   * Answer the question up in the tab, which is a `kind` the test knows: record
   * it, send the table's keys (Esc for the update offer), and wait for it to go.
   * A return goes only when the selection is on the choice the table says it
   * takes; otherwise nothing more is sent and the test stops with the screen.
   */
  async function answer(kind, question) {
    const row = SCREENS[kind];
    const record = seen[kind];
    if (record.appeared) assert.fail(`the premise: ${row.name} came back after it was answered.${whatIsUp(handle)}`);
    record.appeared = true;
    record.start = selectionIn(question) ?? '(no selection found)';
    for (const line of rowsOf(handle) ?? []) t.diagnostic(`${row.name} | ${line}`);
    const startsRight = row.starts.test(record.start);

    let keys;
    if (kind === 'update') {
      keys = ['\x1b'];
    } else if (kind === 'hooks' && !SCREENS.hooks.takes.test(record.start)) {
      keys = ['\x1b[B', '\r'];
    } else {
      keys = ['\r'];
    }
    record.sent = written(keys);

    for (const key of keys) {
      if (key === '\r') {
        // Read the screen again before the return: it takes whatever is highlighted.
        const now = questionIn(handle);
        const on = now === undefined ? undefined : selectionIn(now);
        if (on === undefined || !row.takes.test(on)) {
          record.outcome = `stopped before the return: the selection is on ${JSON.stringify(on ?? null)}`;
          assert.fail(`the premise: before the return on ${row.name}, the selection should be on what the table takes, and is on ${JSON.stringify(on ?? null)}. Nothing more was sent.${whatIsUp(handle)}`);
        }
      }
      sendKeys(handle, key);
      await setTimeout(KEY_GAP_MS);
    }

    // Moved on: the question up now, if any, is no longer this one.
    await until(`${row.name} to move on after ${record.sent}`, MOVE_MS, async () => {
      const now = questionIn(handle);
      return now === undefined || kindOf(now) !== kind ? true : undefined;
    }, () => whatIsUp(handle));
    const front = inFront(handle);
    const next = questionIn(handle);
    record.outcome = `the screen went; ${front ?? 'nothing readable'} in front${next === undefined ? '' : `; next: ${SCREENS[kindOf(next)]?.name ?? 'a question the test does not know'}`}`;
    record.matches = startsRight && front === 'codex';
    return front;
  }

  // 1. Bring-up: whatever Codex asks, in whatever order, until the kit's hook
  // has told the book the conversation and no question is up.
  await until(
    `${BOT.title} to be past its first-run screens, with the conversation in the book`,
    READY_MS + ANSWER_MS,
    async () => {
      const question = questionIn(handle);
      if (question !== undefined) {
        const kind = kindOf(question);
        if (kind === null) assert.fail(`the premise: a question the test does not know is up in ${BOT.title}, and nothing was typed into it.${whatIsUp(handle)}`);
        const front = await answer(kind, question);
        if (kind === 'hooks') {
          // Trust all and continue: the kit's hook runs, and the book learns the id.
          const id = await until('the kit\'s hook to report the conversation', ANSWER_MS, async () => (await sessionIn(home, 'daily')).session, () => whatIsUp(handle));
          seen.hooks.outcome += `; the kit's hook ran (the book holds ${id})`;
          seen.hooks.matches = seen.hooks.matches && front === 'codex';
        }
        if (kind === 'update') {
          const after = codexVersion();
          seen.update.outcome += `; codex --version ${after === version ? 'unchanged' : `now ${after}`}`;
          seen.update.matches = seen.update.matches && after === version;
        }
        return undefined;
      }
      return typeof (await sessionIn(home, 'daily')).session === 'string' ? true : undefined;
    },
    () => whatIsUp(handle),
  );
  assert.equal(inFront(handle), 'codex', `the premise: codex is in front of ${BOT.title} once past its screens.${whatIsUp(handle)}`);

  // 2. `/new`, typed once the session is idle and no question is up.
  await until(`${BOT.title} to be idle with no question up`, READY_MS, async () => {
    const idle = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
    return idle.ok === true && waitingOn(orca, handle) === undefined ? true : undefined;
  }, () => `${waitingOn(orca, handle) ?? ''}${whatIsUp(handle)}`);

  let menu;
  for (let tries = 1; menu === undefined; tries += 1) {
    const why = waitingOn(orca, handle);
    assert.equal(why, undefined, `the premise: nothing is up in ${BOT.title} before \`/new\` goes in, and${why}\n  Nothing was typed.`);
    sendKeys(handle, '/new');
    await setTimeout(KEY_GAP_MS);
    sendKeys(handle, '\r');
    const stop = Date.now() + MENU_MS;
    let refused = false;
    while (Date.now() < stop) {
      const question = questionIn(handle);
      if (question !== undefined && kindOf(question) === 'new') {
        menu = question;
        break;
      }
      if ((rowsOf(handle) ?? []).some((row) => row.includes('disabled while a task is in progress'))) refused = true;
      await setTimeout(1000);
    }
    if (menu !== undefined) break;
    if (!refused || tries >= 5) {
      seen.new.outcome = refused
        ? `\`/new\` was refused ${tries} times while a task was in progress`
        : `no menu came after \`/new\`: ${JSON.stringify((rowsOf(handle) ?? []).slice(-8))}`;
      break;
    }
    // Refused while a turn runs: wait for the tab to be idle again, then try once more.
    await setTimeout(5000);
  }

  if (menu !== undefined) {
    const front = await answer('new', menu);
    const worktreesAfter = worktreesOf(bots);
    seen.new.outcome += `; the bots repository's worktrees ${worktreesAfter === worktreesBefore ? 'unchanged' : `went from ${worktreesBefore} to ${worktreesAfter}`}`;
    seen.new.matches = seen.new.matches && front === 'codex' && worktreesAfter === worktreesBefore;
  }

  // 3. An update offer can come up at any point; one still up now is answered
  // the same way, with Esc.
  const late = questionIn(handle);
  if (late !== undefined && kindOf(late) === 'update') {
    await answer('update', late);
    const after = codexVersion();
    seen.update.outcome += `; codex --version ${after === version ? 'unchanged' : `now ${after}`}`;
    seen.update.matches = seen.update.matches && after === version;
  }
});
