// A bot's locks are in its own folder of `<bots>.locks`, and a lock the process
// cannot write is an error, never a lock taken (#534).
//
// The kit takes its turns with SQLite write transactions on files beside the
// bots folder: the book's lock, and each session's mailbox, typing, lines and
// name turns. A Codex session may write only in its own bot's folders
// (test/sandbox-launch-dirs.test.js), so every lock of a bot is under
// `<bots>.locks/<bot>/`, and nothing is directly in `<bots>.locks`. Which file
// in that folder is which lock is the kit's own business and is not pinned
// here; two writers of one bot still exclude each other there.
//
// Seen live in Codex's sandbox: an existing lock file the session cannot write
// opens read-only, and SQLite's `BEGIN IMMEDIATE` on it succeeds without
// excluding anyone. So a writer that cannot write its lock file must fail, and
// say so, rather than go on as if it held the lock. The likely cause is a Codex
// session started before its bot's folders were given to it, and what puts it
// right is a new start, so the error says "restart this session with the kit"
// (the architect, 2026-10-10). The sandbox is stood in for here by file modes:
// lock files 0444 and their folders 0555. Root writes whatever the mode, so
// those tests skip as root.
//
// Where a lock is held by another process, it is a process of its own started
// here and left to end by itself, as in test/locks-through-a-link.test.js:
// every wait in it is bounded, and nothing here signals or kills a process.

import assert from 'node:assert/strict';
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

import { takeLineTurn, takeMailboxTurn, takeNameTurn, takeTypingTurn, updateBook } from '../src/book.js';
import {
  bookOf,
  botHomeOf,
  createSandbox,
  kitLaunchMark,
  node,
  orcaApp,
  repoRoot,
  sentInto,
  sessionIn,
  shellWord,
  spellingsOf,
} from './helpers/cli.js';

/** The module under test, as the writers in processes of their own import it. */
const bookModule = pathToFileURL(path.join(repoRoot, 'src', 'book.js')).href;

/** Root writes a file whatever its mode, so no lock can be kept from being written. */
const NEEDS_A_USER = process.getuid?.() === 0
  && 'runs as root, which writes a file whatever its mode, so a lock cannot be made unwritable';

/** What the error says to do about a lock the process cannot write (the architect, 2026-10-10). */
const RESTART = /restart this session with the kit/i;

/** `obk`, which must work. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}:\n${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder with `bots` = [[name, harness]], one daily session each, brought up when `up`. */
async function fleetIn(box, bots, { up = true } = {}) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  for (const [bot, harness] of bots) {
    await ok(box, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    await ok(box, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
  }
  if (up) await ok(box, ['up', '--bots', 'bots']);
  return box.path('bots');
}

/** Every file under `dir`, at any depth, or none when it is not there. */
async function filesUnder(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const name of names) {
    const at = path.join(dir, name);
    if ((await stat(at)).isDirectory()) found.push(...await filesUnder(at));
    else found.push(at);
  }
  return found.sort();
}

/** Every folder under `dir`, at any depth, `dir` itself first. */
async function foldersUnder(dir) {
  const found = [dir];
  for (const name of await readdir(dir)) {
    const at = path.join(dir, name);
    if ((await stat(at)).isDirectory()) found.push(...await foldersUnder(at));
  }
  return found;
}

/**
 * Make everything under `dir` unwritable, as Codex's sandbox has it for a
 * session that was not given it: each file 0444 and each folder 0555, but
 * nothing under `except`. Returns the function that gives every mode back,
 * which the test calls itself, in a `finally`: the sandbox is removed before
 * a hook of the test's own would run, and it cannot remove a folder it cannot
 * write.
 */
async function unwritable(dir, { except } = {}) {
  const spared = (at) => except !== undefined && (at === except || at.startsWith(`${except}${path.sep}`));
  const folders = (await foldersUnder(dir)).filter((at) => !spared(at));
  const files = (await filesUnder(dir)).filter((at) => !spared(at));
  const modes = new Map();
  for (const at of [...folders, ...files]) modes.set(at, (await stat(at)).mode & 0o7777);
  for (const file of files) await chmod(file, 0o444);
  for (const folder of [...folders].reverse()) await chmod(folder, 0o555);
  return async () => {
    for (const folder of folders) await chmod(folder, modes.get(folder));
    for (const file of files) await chmod(file, modes.get(file));
  };
}

/** The book of one bot, as text, or undefined when there is none. */
const bookText = (bots, bot) => readFile(bookOf(bots, bot), 'utf8').catch(() => undefined);

// ------------------------------------------------------------- where they are

test('SK1 every lock of a bot, the book\'s and each session turn, is under <bots>.locks/<bot>/, and none is directly in <bots>.locks', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['api-bot', 'codex']]);
  const locks = `${bots}.locks`;
  const fatherBefore = await filesUnder(path.join(locks, 'bot-father'));
  const home = botHomeOf(bots, 'api-bot');

  // Each lock of api-bot, taken through the kit: a mail check takes the
  // session's mailbox turn, and the rest are taken here.
  await ok(box, ['message', 'check', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);
  await updateBook(home, () => undefined);
  takeMailboxTurn(home, 'daily').release();
  const typing = takeTypingTurn(home, 'daily', 0);
  assert.ok(typing, 'the premise: the typing turn was free');
  typing.release();
  const line = takeLineTurn(home, 'daily', 0);
  assert.ok(line, 'the premise: the line turn was free');
  line.release();
  const name = takeNameTurn(home, 'daily');
  assert.ok(name, 'the premise: the name turn was free');
  name.release();

  const files = await filesUnder(locks);
  assert.deepEqual(files.filter((file) => path.dirname(file) === locks), [], `nothing is directly in ${locks}, got: ${JSON.stringify(files)}`);
  for (const file of files) {
    assert.ok(
      [path.join(locks, 'api-bot'), path.join(locks, 'bot-father')].includes(path.dirname(file)),
      `every lock is in its own bot's folder of ${locks}, got: ${file}`,
    );
  }
  assert.ok(files.some((file) => path.dirname(file) === path.join(locks, 'api-bot')), `api-bot's locks are in ${path.join(locks, 'api-bot')}, got: ${JSON.stringify(files)}`);
  assert.deepEqual(await filesUnder(path.join(locks, 'bot-father')), fatherBefore, 'nothing of api-bot\'s went into Bot Father\'s folder');
});

// --------------------------------------------------- writers in their own processes

/** How long the writer inside holds the book's lock once it has it, when it holds for a time. */
const HOLDS_MS = 1500;

/** How long after the first said it was inside the second comes for the lock. */
const ARRIVES_AFTER_MS = 300;

/**
 * One writer of the book, as a process of its own, through `updateBook`: it
 * adds a session named after itself. `holds` keeps the lock that long once
 * inside; `holdsUntil` keeps it until that file is there (20 s at most).
 * `arrivesAfter` waits for another writer to say it is inside, then that long
 * more. Steps logged: `arrived` just before asking, `holding` the moment it is
 * inside, and `committed`, or `refused` with the error's message.
 */
async function aWriter(box, home, name, { holds = 0, holdsUntil = null, arrivesAfter = 0 } = {}) {
  const dir = path.join(box.root, 'writers');
  await mkdir(dir, { recursive: true });
  const script = path.join(dir, `${name}.mjs`);
  const log = path.join(dir, 'writers.log');
  const inside = path.join(dir, 'inside');

  await writeFile(script, `${[
    "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { setTimeout as sleep } from 'node:timers/promises';",
    `import { updateBook } from ${JSON.stringify(bookModule)};`,
    '',
    `const NAME = ${JSON.stringify(name)};`,
    `const HOME = ${JSON.stringify(home)};`,
    `const LOG = ${JSON.stringify(log)};`,
    `const INSIDE = ${JSON.stringify(inside)};`,
    `const HOLDS = ${JSON.stringify(holds)};`,
    `const HOLDS_UNTIL = ${JSON.stringify(holdsUntil)};`,
    `const ARRIVES_AFTER = ${JSON.stringify(arrivesAfter)};`,
    '',
    'const now = () => Number(process.hrtime.bigint()) / 1e6;',
    'const say = (what, more = {}) => appendFileSync(LOG, `${JSON.stringify({ writer: NAME, what, at: now(), ...more })}\\n`);',
    '',
    'if (ARRIVES_AFTER > 0) {',
    '  const until = Date.now() + 20_000;',
    '  while (!existsSync(INSIDE) && Date.now() < until) await sleep(20);',
    "  const took = existsSync(INSIDE) ? Number(readFileSync(INSIDE, 'utf8')) : now();",
    '  await sleep(Math.max(0, took + ARRIVES_AFTER - now()));',
    '}',
    '',
    "say('arrived');",
    'try {',
    '  await updateBook(HOME, async (book) => {',
    '    writeFileSync(INSIDE, String(now()));',
    "    say('holding');",
    '    if (HOLDS > 0) await sleep(HOLDS);',
    '    if (HOLDS_UNTIL !== null) {',
    '      const until = Date.now() + 20_000;',
    '      while (!existsSync(HOLDS_UNTIL) && Date.now() < until) await sleep(20);',
    '    }',
    '    book.sessions = { ...book.sessions, [NAME]: { tab: `tab-${NAME}` } };',
    '  });',
    "  say('committed');",
    '} catch (error) {',
    "  say('refused', { message: error.message });",
    '  process.stderr.write(`${error.message}\\n`);',
    '  process.exitCode = 1;',
    '}',
  ].join('\n')}\n`);

  return {
    name,
    inside,
    run: () => node([script], { cwd: box.cwd, env: box.env }),
    async steps() {
      const text = await readFile(log, 'utf8').catch(() => '');
      return text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
    },
  };
}

/** The steps one writer took of one kind. */
const stepsOf = (steps, writer, what) => steps.filter((step) => step.writer === writer && step.what === what);

/** Wait, 20 s at most, until `file` is there. */
async function untilThere(file) {
  for (const until = Date.now() + 20_000; Date.now() < until; await sleep(20)) {
    if (await stat(file).then(() => true, () => false)) return true;
  }
  return false;
}

test('SK2 two writers of one bot\'s book, both able to write, take one lock in <bots>.locks/<bot>/: the second waits for the first, and both changes are kept', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['api-bot', 'codex']], { up: false });
  const home = botHomeOf(bots, 'api-bot');

  const first = await aWriter(box, home, 'first', { holds: HOLDS_MS });
  const second = await aWriter(box, home, 'second', { arrivesAfter: ARRIVES_AFTER_MS });
  const [one, two] = await Promise.all([first.run(), second.run()]);

  assert.equal(one.code, 0, `the first got in and finished: ${one.stderr}`);
  assert.equal(two.code, 0, `the second waited its turn and finished: ${two.stderr}`);
  const steps = await first.steps();
  const inside = stepsOf(steps, 'first', 'holding')[0]?.at;
  const arrived = stepsOf(steps, 'second', 'arrived')[0]?.at;
  const got = stepsOf(steps, 'second', 'holding')[0]?.at;
  assert.ok(inside !== undefined && arrived !== undefined && got !== undefined, `every step was taken, got: ${JSON.stringify(steps)}`);
  assert.ok(arrived < inside + HOLDS_MS, `the premise: the second asked while the first held the lock, got: ${JSON.stringify(steps)}`);
  assert.ok(got >= inside + HOLDS_MS, `the second did not get in beside the first, got: ${JSON.stringify(steps)}`);
  const book = parse(await bookText(bots, 'api-bot'));
  assert.deepEqual(['first', 'second'].map((name) => book.sessions?.[name]?.tab), ['tab-first', 'tab-second'], 'both changes are in the book');

  const locks = `${bots}.locks`;
  const files = await filesUnder(locks);
  assert.ok(files.some((file) => path.dirname(file) === path.join(locks, 'api-bot')), `the lock they took is in ${path.join(locks, 'api-bot')}, got: ${JSON.stringify(files)}`);
  assert.deepEqual(files.filter((file) => path.dirname(file) === locks), [], `and nothing is directly in ${locks}`);
});

test('SK3 a writer that cannot write the lock file does not get the book\'s lock that another process holds: it fails, says to restart with the kit, and writes nothing', { skip: NEEDS_A_USER }, async (t) => {
  // The case seen live: the holder took the lock where it could write; the
  // other one, in a sandbox, opens the same file read-only, and BEGIN
  // IMMEDIATE lets it in beside the holder.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['api-bot', 'codex']], { up: false });
  const home = botHomeOf(bots, 'api-bot');
  const release = path.join(box.root, 'writers', 'release');

  const holder = await aWriter(box, home, 'holder', { holdsUntil: release });
  const held = holder.run();
  let restore;
  let barred;
  try {
    assert.ok(await untilThere(holder.inside), 'the premise: the holder got in');
    restore = await unwritable(`${bots}.locks`);
    const sandboxed = await aWriter(box, home, 'sandboxed');
    barred = await sandboxed.run();
  } finally {
    await writeFile(release, '');
    await held;
    if (restore) await restore();
  }

  const steps = await holder.steps();
  assert.deepEqual(stepsOf(steps, 'sandboxed', 'holding'), [], `the one that cannot write never got in, got: ${JSON.stringify(steps)}`);
  assert.notEqual(barred.code, 0, `it fails, got: ${JSON.stringify(steps)}`);
  const refused = stepsOf(steps, 'sandboxed', 'refused');
  assert.equal(refused.length, 1, `it says why, got: ${JSON.stringify(steps)}`);
  assert.match(refused[0].message, RESTART, `and says to restart the session with the kit, got: ${refused[0].message}`);
  const book = parse(await bookText(bots, 'api-bot'));
  assert.equal(book.sessions?.holder?.tab, 'tab-holder', 'the holder\'s change is in the book');
  assert.equal(book.sessions?.sandboxed, undefined, 'and nothing of the one that could not write');
});

for (const [label, prepare] of [
  ['lock file is there and cannot be written', async () => {}],
  ['lock folder cannot be written and holds no lock file yet', async (bots) => {
    for (const file of await filesUnder(path.join(`${bots}.locks`, 'api-bot'))) await rm(file);
  }],
]) {
  test(`SK4 a book write whose ${label} fails, says to restart with the kit, and leaves the book as it was`, { skip: NEEDS_A_USER }, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, [['api-bot', 'codex']], { up: false });
    const home = botHomeOf(bots, 'api-bot');
    // Once through the lock, so that its file is there.
    await updateBook(home, (book) => {
      book.sessions = { ...book.sessions, before: { tab: 'tab-before' } };
    });
    await prepare(bots);
    const before = await bookText(bots, 'api-bot');

    let called = false;
    let failure;
    const restore = await unwritable(`${bots}.locks`);
    try {
      await updateBook(home, (book) => {
        called = true;
        book.sessions = { ...book.sessions, after: { tab: 'tab-after' } };
      });
    } catch (error) {
      failure = error;
    } finally {
      await restore();
    }

    assert.ok(failure, 'the write fails rather than going on without the lock');
    assert.match(failure.message, RESTART, `and says to restart the session with the kit, got: ${failure.message}`);
    assert.equal(called, false, 'the change is never made');
    assert.equal(await bookText(bots, 'api-bot'), before, 'and the book is as it was');
  });
}

// ------------------------------------------------------------- session turns

test('SK5 a mail check whose mailbox turn cannot be written fails, says to restart with the kit, and reads nothing', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['writer', 'claude'], ['coder', 'codex']]);
  await ok(box, ['message', 'send', '--bots', 'bots', '--from', 'writer/daily', '--to', 'coder', '--subject', 'the log', '--text', 'It failed twice.']);
  assert.deepEqual((await box.orca.messages()).map((one) => one.acked), [false], 'the premise: the mail is waiting');

  let checked;
  const restore = await unwritable(`${bots}.locks`);
  try {
    checked = await box.run(['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);
  } finally {
    await restore();
  }

  const said = `${checked.stdout}${checked.stderr}`;
  assert.notEqual(checked.code, 0, `the check fails, got:\n${said}`);
  assert.ok(!/^\s+at /m.test(said), `with a message, not a crash:\n${said}`);
  assert.match(said, RESTART, `and says to restart the session with the kit, got:\n${said}`);
  assert.ok(!said.includes('It failed twice.'), `nothing is read, got:\n${said}`);
  assert.deepEqual((await box.orca.messages()).map((one) => one.acked), [false], 'and the mail is still waiting in Orca');
});

// A Codex session sends from its own tab, in its sandbox: it can write its own
// bot's locks and not the receiver's. The receiver's line turn cannot be
// taken, so the send cannot type its line; it is not let past the lock
// either. The message is queued, nothing is typed, and the nudge is left for
// the sending session's PostToolUse hook, which Codex runs outside the sandbox
// (src/message.js, leftForHook; test/nudge-left-for-hook.test.js). That hook,
// where the lock can be written, then types the line.

/** The subject every send here carries. */
const SUBJECT = 'the review of PR 12';

/** The environment of a command run in reviewer/daily's tab, with what a Codex tool command carries. */
async function inReviewerTab(box, bots, { codexCommand }) {
  const { tab } = await sessionIn(bots, 'reviewer', 'daily');
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(terminal, 'the premise: Orca has reviewer/daily\'s tab');
  const mark = kitLaunchMark(box, terminal);
  assert.equal(typeof mark.OBK_TAB_SHELL, 'string', 'the premise: reviewer/daily was started on the kit\'s launch line');
  const thread = '0199b2c0-0408-4444-8888-cccccccccccc';
  return {
    ...box.env,
    ORCA_TAB_ID: terminal.tabId,
    ORCA_TERMINAL_HANDLE: terminal.handle,
    ...mark,
    ...(codexCommand ? { CODEX_THREAD_ID: thread, CODEX_SESSION_ID: thread, CODEX_SANDBOX: 'seatbelt' } : {}),
  };
}

/** Codex's PostToolUse payload after its shell tool ran the send. */
const afterBash = (bots) => `${JSON.stringify({
  session_id: '0199b2c0-0408-4444-8888-cccccccccccc',
  turn_id: 'turn-3',
  transcript_path: '/nowhere/rollout.jsonl',
  cwd: botHomeOf(bots, 'reviewer'),
  hook_event_name: 'PostToolUse',
  model: 'gpt-5.5',
  permission_mode: 'default',
  tool_name: 'Bash',
  tool_input: { command: `"$OBK_CLI" message send --bots bots --to developer --subject '${SUBJECT}' --text 'Approved.' --json` },
  tool_response: '{"sent": true}',
  tool_use_id: 'call_7',
})}\n`;

/** What was typed into each tab after its launch line. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = sentInto(terminal).slice(1);
  return after;
}

test('SK6 mail from a Codex session in its own tab, whose receiver\'s typing and line turns it cannot write, is queued, types nothing, and leaves the nudge for its hook, which types it', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['developer', 'claude'], ['reviewer', 'codex']]);
  // Orca's runtime names the idle Claude Code in the developer's tab, so with
  // its lock writable the send would type the line itself
  // (nudge-left-for-hook.test.js, A7). `ps` does not start, as in the sandbox.
  await orcaApp(box);
  await box.orca.set({ ps: 'not-permitted' });
  const developer = (await sessionIn(bots, 'developer', 'daily')).tab;
  const env = await inReviewerTab(box, bots, { codexCommand: true });

  let sent;
  const restore = await unwritable(`${bots}.locks`, { except: path.join(`${bots}.locks`, 'reviewer') });
  try {
    sent = await box.run(['message', 'send', '--bots', 'bots', '--to', 'developer', '--subject', SUBJECT, '--text', 'Approved.', '--json'], { env });
  } finally {
    await restore();
  }

  assert.equal(sent.code, 0, `the message goes whatever became of the nudge:\n${sent.stdout}${sent.stderr}`);
  const answer = JSON.parse(sent.stdout);
  assert.equal(answer.sent, true, `it is sent, got: ${sent.stdout}`);
  assert.equal(answer.nudged, false, `the send types nothing, got: ${sent.stdout}`);
  assert.equal(answer.nudgeLeft, true, `and leaves the nudge for the sending session's hook, got: ${sent.stdout}`);
  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'and nothing was typed into any tab');

  // The hook, outside the sandbox, where `ps` runs and the lock can be written.
  await box.orca.set({ ps: undefined });
  const hook = await box.run(['session', 'nudge', '--bots', 'bots', '--bot', 'reviewer'], {
    env: await inReviewerTab(box, bots, { codexCommand: false }),
    stdin: afterBash(bots),
  });

  assert.equal(hook.code, 0, `a hook never fails the session: ${hook.stderr}`);
  const typed = await typedSinceLaunch(box);
  const lines = spellingsOf(box.cli).map(
    (cli) => `Fleet mail from reviewer/daily: ${SUBJECT}. Read it with  ${cli} message check --bots ${shellWord(bots)} --bot developer --session daily`,
  );
  assert.equal(typed[developer].length, 1, `the hook types one line into the receiver's tab, got: ${JSON.stringify(typed[developer])}`);
  assert.ok(lines.includes(typed[developer][0].text), `the line the send would have typed, got: ${typed[developer][0].text}`);
  for (const [tab, sentLines] of Object.entries(typed)) {
    if (tab !== developer) assert.deepEqual(sentLines, [], `nothing is typed into ${tab}`);
  }
});
