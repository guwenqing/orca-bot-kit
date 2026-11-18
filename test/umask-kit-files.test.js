// A start of a session does not depend on the umask for the files and folders
// that only the kit writes and reads (#764).
//
// The kit keeps folders of its own beside the bots folder `<bots>`:
// `<bots>.locks/<bot>`, `<bots>.prompts/<bot>` and `<bots>.messages/<bot>`
// (`kitFolders` of src/launch.js), and `<bots>.claude-text/<bot>`
// (`claudeTextFolder`). Only the kit writes and reads what is in them. What is
// held here:
//
//   U1  under umask 0222, a first start (`up`) and a second start of one
//       session both go through: a Codex session, a Claude session (its bot's
//       memory folder made before, as #752 needs), and a session with a long
//       start prompt whose second start writes a changed prompt; each when the
//       kit's folders were made before under the usual umask, and when none
//       of them is there yet
//   U2  what the kit makes there has the owner's bits: a folder at least
//       u+rwx, a file at least u+rw
//   U3  the kit gives group and other no bit that the umask takes away. Under
//       umask 077 a lock file is 0600 and a folder 0700; under umask 0222 a
//       lock file is 0644 and a folder 0755
//   U4  a lock file that an earlier kit left with mode 444 keeps its mode: the
//       command fails, names the file, says that its owner cannot write it and
//       gives `chmod u+w <file>`; nothing is started. With the write bit given
//       back, the same command goes through
//   U5  a start prompt file that an earlier kit left with mode 444 does not stop
//       the start, and holds the new prompt after it
//   U6  the boundary: under umask 0222, the files a user reads and edits by
//       hand (bot.yaml, AGENTS.md, CLAUDE.md, sessions.yaml in the bot folder)
//       keep the mode the umask gives when the kit makes them: 0444
//   U7  under umask 0222, the first `up` of a Codex bot that is not yet in
//       Orca, with none of the kit's folders there, goes through: the bot's
//       project is in Orca, the session's tab is open with its line typed, and
//       the kit leaves no `.git` of its own in the bot home
//
// U2 and U3 are read on every entry that a run made in the kit's folders: an
// entry there before the run is not the run's, and is not read.
//
// A start that the tests run under a umask goes through a real shell, as F7 of
// test/memory-folder-made.test.js does: `umask <mask>; exec obk …`. Every start
// of a session begins with one start of another session of the same bot under
// the usual umask, `control`: it adds the bot to Orca and, for a Claude bot,
// makes its memory folder. For the case where none of the kit's folders is
// there, the test then takes all four away before the start under the umask.
//
// Root ignores modes, so every case here is skipped as root.
//
// Every run is in a sandbox (helpers/cli.js): its own HOME, a fake Orca, and no
// real harness. Nothing here reads the real Orca's data or a real profile.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, lstat, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookIn,
  bookLockFile,
  botHomeOf,
  botLockFile,
  conversationOnRecord,
  createSandbox,
  promptFileOf,
  recordSession,
  sessionIn,
  sh,
  shellWord,
  spellingsOf,
  turnLockFile,
  typedInto,
} from './helpers/cli.js';

const BOT = 'api-bot';

const AS_ROOT = process.getuid?.() === 0 ? 'root writes into a file and a folder of any mode, so a mode cannot stop the kit here' : undefined;

/** The kit's folders beside the bots folder, by the name they carry after `<bots>`. */
const KIT_TOPS = ['.locks', '.prompts', '.messages', '.claude-text'];

/** A start prompt too long to go on the launch line: the kit writes it to `<bots>.prompts/<bot>/<session>.txt`. */
const LONG_PROMPT = `You keep the API bot's day running, first version. ${'Read the open issues and say what is due. '.repeat(6)}`.trim();
/** Another one, for the second start. */
const CHANGED_PROMPT = `You keep the API bot's day running, changed version. ${'Read the open pull requests and say what is due. '.repeat(6)}`.trim();

/** Mode bits as an octal string, for messages. */
const octal = (mode) => `0${(mode & 0o777).toString(8)}`;

/** A run of `obk` with the usual umask that must go through. */
async function ok(box, args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have gone through:\n${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Run `obk <args>` through a real shell under `mask`. The sandbox's own
 * environment is kept, so it is the sandbox's `obk` on PATH.
 */
const underUmask = (box, mask, args) => sh(`umask ${mask}; exec obk ${args.map(shellWord).join(' ')}`, { cwd: box.cwd, env: box.env });

const upArgs = (session = 'daily') => ['up', '--bots', 'bots', '--bot', BOT, '--session', session];
const restartArgs = (session = 'daily') => ['restart', '--bots', 'bots', '--bot', BOT, '--session', session];

/**
 * A sandbox with Bot Father, and api-bot on `harness` with the sessions
 * `control` and `daily`; `daily` has `prompt` when one is given. `control` is
 * started with the usual umask: the bot is in Orca, and a Claude bot has its
 * memory folder.
 */
async function fleet(t, { harness, prompt }) {
  const box = await createSandbox(t);
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'control']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', ...(prompt === undefined ? [] : ['--prompt', prompt])]);
  await ok(box, upArgs('control'));
  const bots = box.path('bots');
  if (harness === 'claude') assert.ok(existsSync(path.join(botHomeOf(bots, BOT), 'claude-memory')), 'the control: the usual start made the Claude bot\'s memory folder');
  return { box, bots, home: botHomeOf(bots, BOT) };
}

/** Take all of the kit's folders away, so the next start makes each of them. */
async function noKitFolders(bots) {
  for (const top of KIT_TOPS) await rm(`${bots}${top}`, { recursive: true, force: true });
  for (const top of KIT_TOPS) assert.ok(!existsSync(`${bots}${top}`), `${bots}${top} should be gone`);
}

/**
 * Every entry in the kit's folders, the top folders among them, by path:
 * `{ mode, dir }`. Links are not followed.
 */
async function kitEntries(bots) {
  const found = new Map();
  for (const top of KIT_TOPS) {
    const root = `${bots}${top}`;
    if (!existsSync(root)) continue;
    const add = async (at) => {
      const seen = await lstat(at);
      found.set(at, { mode: seen.mode & 0o777, dir: seen.isDirectory() });
    };
    await add(root);
    for (const name of await readdir(root, { recursive: true })) await add(path.join(root, name));
  }
  return found;
}

/** The entries of `after` that `before` did not have: what one run made. */
function madeSince(before, after) {
  return [...after].filter(([at]) => !before.has(at));
}

/**
 * U2 and U3 on what one run made under `mask`: a folder has u+rwx and a file
 * u+rw; group and other have no bit that the umask takes away from the usual
 * 0777 of a folder and 0666 of a file. With `exact`, each folder and each lock
 * file has exactly the mode of the example: the umask's mode with the owner's
 * bits added.
 */
function assertModes(made, mask, why, { exact = false } = {}) {
  const wrong = [];
  for (const [at, { mode, dir }] of made) {
    const base = dir ? 0o777 : 0o666;
    const owner = dir ? 0o700 : 0o600;
    const umaskGives = base & ~mask;
    if ((mode & owner) !== owner) wrong.push(`${at} is ${octal(mode)}: a ${dir ? 'folder' : 'file'} the kit made needs at least ${dir ? 'u+rwx' : 'u+rw'}`);
    if ((mode & 0o077 & ~umaskGives) !== 0) wrong.push(`${at} is ${octal(mode)}: the umask ${octal(mask)} gives group and other no more than ${octal(umaskGives & 0o077)}`);
    if (exact && (dir || at.endsWith('.lock')) && mode !== (umaskGives | owner)) wrong.push(`${at} is ${octal(mode)}: under umask ${octal(mask)} a ${dir ? 'folder' : 'lock file'} the kit makes is ${octal(umaskGives | owner)}`);
  }
  assert.deepEqual(wrong, [], `${why}: what the kit made in its folders has the wrong mode:\n${wrong.join('\n')}`);
}

/** How many texts each terminal has had typed into it, by handle. */
async function typedNow(box) {
  return new Map((await box.orca.terminals()).map((one) => [one.handle, (one.typed ?? []).length]));
}

/** A text names the session, as the kit's launch line and its mailbox step do. */
const namesSession = (text, session) => text.includes(`--bot ${BOT} --session ${session}`) || text.includes(` -n ${BOT}.${session}.`);

/**
 * The session started in the fake Orca since `before`: the book holds a tab for
 * it, Orca has that tab, and a text typed into it since `before` names the
 * session. Gives back what was typed there since `before`.
 */
async function assertStarted(box, bots, before, why, session = 'daily') {
  const entry = await sessionIn(bots, BOT, session);
  assert.equal(typeof entry?.tab, 'string', `${why}: the book should hold a tab for ${BOT} ${session}, got ${JSON.stringify(entry)}`);
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `${why}: Orca should have ${BOT} ${session}'s tab ${entry.tab}`);
  const since = typedInto(terminal).slice(before.get(terminal.handle) ?? 0);
  assert.ok(since.some((text) => namesSession(text, session)), `${why}: a line that names ${BOT} ${session} should have been typed into its tab ${entry.tab}, got:\n${since.join('\n')}`);
  return since;
}

/** Nothing was started since `before`: no new tab, and nothing typed anywhere. */
async function assertNothingStarted(box, before, why) {
  for (const one of await box.orca.terminals()) {
    assert.ok(before.has(one.handle), `${why}: Orca should have no new tab, got ${one.tabId}`);
    const since = typedInto(one).slice(before.get(one.handle));
    assert.deepEqual(since, [], `${why}: nothing should be typed into ${one.tabId}, got:\n${since.join('\n')}`);
  }
}

/** A start under `mask` that must go through, and start the session. */
async function startUnder(box, bots, mask, args, why) {
  const before = await typedNow(box);
  const ran = await underUmask(box, mask, args);
  assert.equal(ran.code, 0, `${why}: obk ${args.join(' ')} under umask ${mask} should go through, got exit ${ran.code}:\n${ran.stdout}${ran.stderr}`);
  return assertStarted(box, bots, before, why);
}

/** The session's tab, closed the way a user closes one: Orca stops listing it. */
async function closeTab(box, bots, session = 'daily') {
  const { tab } = await sessionIn(bots, BOT, session);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `Orca should have had ${session}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.filter((one) => one.tabId !== tab) });
}

/** Tell the book which conversation a Claude session runs, as the kit's hook does: what a restart resumes. */
async function reported(box, bots, session = 'daily') {
  const { tab } = await sessionIn(bots, BOT, session);
  const id = `conversation-of-${session}`;
  const ran = await recordSession(box, { bots, bot: BOT, tab, session: id, source: 'startup' });
  assert.equal(ran.code, 0, `the kit's hook should record ${session}'s conversation after its first start under the umask, got exit ${ran.code}:\n${ran.stdout}${ran.stderr}`);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, BOT), id });
}

/** Change the start prompt of one session in bot.yaml by hand, as a user does. */
async function promptByHand(home, session, prompt) {
  const file = path.join(home, 'bot.yaml');
  const written = parse(await readFile(file, 'utf8'));
  written.sessions = written.sessions.map((one) => (one.name === session ? { ...one, prompt } : one));
  await writeFile(file, stringify(written));
}

/** The prompt file holds `prompt`, not `old`, and the launch line typed since the start reads it. */
async function assertPromptFile(bots, typed, prompt, old, why) {
  const file = promptFileOf(bots, BOT, 'daily');
  assert.ok(existsSync(file), `${why}: the kit should have written the start prompt to ${file}`);
  const held = await readFile(file, 'utf8');
  assert.ok(held.includes(prompt), `${why}: ${file} should hold the prompt of this start, got:\n${held}`);
  if (old !== undefined) assert.ok(!held.includes(old), `${why}: ${file} should no longer hold the earlier prompt, got:\n${held}`);
  assert.ok(typed.some((text) => spellingsOf(file).some((spelled) => text.includes(spelled))), `${why}: the launch line should read the prompt from ${file}, got:\n${typed.join('\n')}`);
}

/** The premise: under umask 0222 the shell makes a folder 0555 and a file 0444, so the kit's own write into a new folder of its is refused. */
async function assertPremise(box) {
  const probe = path.join(box.root, 'umask-probe');
  const ran = await sh(`umask 0222; mkdir ${shellWord(probe)} && : > ${shellWord(`${probe}-file`)}`, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the premise: the probe should run: ${ran.stderr}`);
  assert.equal(octal((await lstat(probe)).mode), '0555', 'the premise: under umask 0222 a new folder is 0555');
  assert.equal(octal((await lstat(`${probe}-file`)).mode), '0444', 'the premise: under umask 0222 a new file is 0444');
}

// ------------------------------------------------------------------ U1 to U3

/**
 * The cases of U1: the harness, the start prompt, and the second start. A
 * Claude session with no prompt is started again by `obk restart`; the others
 * by `up` once its tab is gone, which is a new conversation and so writes the
 * start prompt again.
 */
const CASES = [
  { label: 'a Codex session', harness: 'codex', again: 'up after its tab is gone' },
  { label: 'a Claude session, its bot\'s memory folder made before', harness: 'claude', again: 'obk restart' },
  { label: 'a Codex session with a long start prompt, changed before its second start', harness: 'codex', prompt: true, again: 'up after its tab is gone' },
  { label: 'a Claude session with a long start prompt, changed before its second start', harness: 'claude', prompt: true, again: 'up after its tab is gone' },
];

const FOLDERS = [
  { state: 'the kit\'s folders made before under the usual umask', fresh: false },
  { state: 'none of the kit\'s folders there yet', fresh: true },
];

describe('U1 to U3: under umask 0222, a first and a second start of one session go through, and what the kit makes in its folders has the owner\'s bits and no more than the umask gives', { skip: AS_ROOT }, () => {
  for (const { label, harness, prompt, again } of CASES) {
    for (const { state, fresh } of FOLDERS) {
      test(`U1 ${label}, ${state}: up and then ${again}, each under umask 0222, start it; U2 U3 every folder the kit made there is at least u+rwx and every file at least u+rw, with group and other bits only as the umask gives${fresh ? ', each folder 0755 and each lock file 0644' : ''}`, async (t) => {
        const world = await fleet(t, { harness, prompt: prompt ? LONG_PROMPT : undefined });
        const { box, bots, home } = world;
        await assertPremise(box);
        if (fresh) await noKitFolders(bots);

        const before = await kitEntries(bots);
        const first = await startUnder(box, bots, '0222', upArgs(), 'the first start');
        const afterFirst = await kitEntries(bots);
        if (prompt) await assertPromptFile(bots, first, LONG_PROMPT, undefined, 'the first start');

        let second;
        if (again === 'obk restart') {
          await reported(box, bots);
          second = await startUnder(box, bots, '0222', restartArgs(), 'the second start, by obk restart');
        } else {
          await closeTab(box, bots);
          if (prompt) await promptByHand(home, 'daily', CHANGED_PROMPT);
          second = await startUnder(box, bots, '0222', upArgs(), 'the second start, by up after its tab is gone');
        }
        if (prompt) await assertPromptFile(bots, second, CHANGED_PROMPT, LONG_PROMPT, 'the second start');
        const afterSecond = await kitEntries(bots);

        // The control: in the fresh case the first start made the kit's folders that this harness uses.
        if (fresh) {
          for (const top of ['.locks', '.prompts', harness === 'codex' ? '.messages' : '.claude-text']) {
            assert.ok(afterFirst.has(`${bots}${top}`), `the control: the first start should have made ${bots}${top}`);
          }
        }
        assertModes(madeSince(before, afterFirst), 0o222, 'the first start under umask 0222', { exact: fresh });
        assertModes(madeSince(afterFirst, afterSecond), 0o222, 'the second start under umask 0222', { exact: fresh });
      });
    }
  }
});

describe('U3: under umask 077, the kit gives group and other nothing', { skip: AS_ROOT }, () => {
  for (const harness of ['claude', 'codex']) {
    test(`U3 a ${harness === 'claude' ? 'Claude' : 'Codex'} session with a long start prompt and none of the kit's folders there: up and then up after its tab is gone, under umask 077, make each folder 0700 and each lock file 0600, and no entry with a group or other bit`, async (t) => {
      const { box, bots, home } = await fleet(t, { harness, prompt: LONG_PROMPT });
      await noKitFolders(bots);

      const before = await kitEntries(bots);
      await startUnder(box, bots, '077', upArgs(), 'the first start under umask 077');
      const afterFirst = await kitEntries(bots);
      await closeTab(box, bots);
      await promptByHand(home, 'daily', CHANGED_PROMPT);
      await startUnder(box, bots, '077', upArgs(), 'the second start under umask 077');
      const afterSecond = await kitEntries(bots);

      const made = [...madeSince(before, afterFirst), ...madeSince(afterFirst, afterSecond)];
      assert.ok(made.some(([at]) => at.endsWith('.lock')) && made.some(([, { dir }]) => dir), `the control: the starts made lock files and folders, got:\n${made.map(([at]) => at).join('\n')}`);
      assertModes(made, 0o077, 'the starts under umask 077', { exact: true });
    });
  }
});

// ------------------------------------------------------------------ U4

/**
 * The lock files a start of `daily` takes, each at the path the kit uses, and
 * the command that takes it. The bot's own lock is not taken by `up`, so it is
 * held through `session add`, which writes bot.yaml under it.
 */
const LOCKS = [
  { name: 'the book\'s lock', file: (bots) => bookLockFile(bots, BOT), command: 'up' },
  { name: 'the session\'s mailbox lock', file: (bots) => turnLockFile(bots, BOT, 'daily', 'mailbox'), command: 'up' },
  { name: 'the bot\'s Orca project lock', file: (bots) => path.join(`${bots}.locks`, BOT, `${BOT}.project.lock`), command: 'up' },
  { name: 'the bot\'s own lock', file: (bots) => botLockFile(bots, BOT), command: 'session add' },
];

describe('U4: a lock file left with mode 444 is not changed; the command fails and says what to run', { skip: AS_ROOT }, () => {
  for (const { name, file: fileOf, command } of LOCKS) {
    test(`U4 ${name} left 0444 by an earlier kit: obk ${command} fails, keeps its mode, starts and writes nothing, and names the file, says its owner cannot write it and gives chmod u+w <file>; with the write bit back it goes through`, async (t) => {
      const { box, bots, home } = await fleet(t, { harness: 'codex' });
      const file = fileOf(bots);
      // The lock is there: a first start of daily makes the session's own, and its tab is then closed.
      await ok(box, upArgs());
      await closeTab(box, bots);
      assert.ok(existsSync(file), `the premise: the kit made ${file} on an earlier start`);
      await chmod(file, 0o444);
      const yaml = await readFile(path.join(home, 'bot.yaml'), 'utf8');
      const before = await typedNow(box);
      const args = command === 'up' ? upArgs() : ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'nightly'];

      const ran = await box.run(args);

      const said = `${ran.stdout}${ran.stderr}`;
      assert.notEqual(ran.code, 0, `obk ${command} should fail when it cannot write ${file}, got exit 0:\n${said}`);
      assert.equal(octal((await stat(file)).mode), '0444', `the kit leaves the mode of ${file} as it found it`);
      assert.ok(said.includes(file), `what it prints names ${file}, got:\n${said}`);
      assert.match(said, /owner/, `what it prints says that the file's owner cannot write it, got:\n${said}`);
      assert.ok(spellingsOf(file).some((spelled) => said.includes(`chmod u+w ${spelled}`)), `what it prints gives "chmod u+w ${file}", got:\n${said}`);
      await assertNothingStarted(box, before, `obk ${command} that failed on ${file}`);
      assert.equal(await readFile(path.join(home, 'bot.yaml'), 'utf8'), yaml, `obk ${command} that failed on ${file} leaves bot.yaml as it was`);

      // The positive: the cause gone, the same command goes through.
      await chmod(file, 0o644);
      const next = await box.run(args);
      assert.equal(next.code, 0, `with ${file} writable again, obk ${command} goes through:\n${next.stdout}${next.stderr}`);
      if (command === 'up') await assertStarted(box, bots, before, 'the start with the lock writable again');
    });
  }
});

// ------------------------------------------------------------------ U5

describe('U5: a start prompt file left with mode 444 does not stop the start', { skip: AS_ROOT }, () => {
  for (const harness of ['codex', 'claude']) {
    test(`U5 a ${harness === 'claude' ? 'Claude' : 'Codex'} session whose prompt file an earlier kit left 0444: up after its tab is gone, with the prompt changed, goes through and the file then holds the new prompt`, async (t) => {
      const { box, bots, home } = await fleet(t, { harness, prompt: LONG_PROMPT });
      const first = await (async () => {
        const before = await typedNow(box);
        await ok(box, upArgs());
        return assertStarted(box, bots, before, 'the control: the first start');
      })();
      await assertPromptFile(bots, first, LONG_PROMPT, undefined, 'the control: the first start');
      await closeTab(box, bots);
      await chmod(promptFileOf(bots, BOT, 'daily'), 0o444);
      await promptByHand(home, 'daily', CHANGED_PROMPT);
      const before = await typedNow(box);

      const ran = await box.run(upArgs());

      assert.equal(ran.code, 0, `the start should go through with the prompt file left 0444, got exit ${ran.code}:\n${ran.stdout}${ran.stderr}`);
      const typed = await assertStarted(box, bots, before, 'the start with the prompt file left 0444');
      await assertPromptFile(bots, typed, CHANGED_PROMPT, LONG_PROMPT, 'the start with the prompt file left 0444');
    });
  }
});

// ------------------------------------------------------------------ U6

describe('U6: under umask 0222, the files a user edits by hand keep the mode the umask gives', { skip: AS_ROOT }, () => {
  test('U6 up under umask 0222 of a bot whose sessions.yaml, AGENTS.md and CLAUDE.md are gone makes each of them again, and each is 0444, not widened', async (t) => {
    const { box, bots, home } = await fleet(t, { harness: 'codex' });
    await assertPremise(box);
    // No tab of the bot is open, so a book made new holds no tab that Orca has.
    await closeTab(box, bots, 'control');
    const files = ['sessions.yaml', 'AGENTS.md', 'CLAUDE.md'];
    for (const name of files) {
      await rm(path.join(home, name), { force: true });
      assert.ok(!existsSync(path.join(home, name)), `the premise: ${name} is gone before the start`);
    }

    const ran = await underUmask(box, '0222', upArgs());

    assert.equal(ran.code, 0, `the start under umask 0222 should go through:\n${ran.stdout}${ran.stderr}`);
    for (const name of files) {
      const at = path.join(home, name);
      // The positive: the start made the file again, so it was made under the umask.
      assert.ok(existsSync(at), `the control: the start made ${at} again`);
      // CLAUDE.md may be a link to AGENTS.md: what a user reads through it is the file it leads to.
      assert.equal(octal((await stat(at)).mode), '0444', `${at}, made under umask 0222, keeps the mode the umask gives`);
    }
  });

  test('U6 init under umask 0222 in a bots folder whose Bot Father bot.yaml, AGENTS.md and CLAUDE.md are gone makes each of them again, and each is 0444, not widened', async (t) => {
    const box = await createSandbox(t);
    await assertPremise(box);
    await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
    const home = botHomeOf(box.path('bots'));
    const files = ['bot.yaml', 'AGENTS.md', 'CLAUDE.md'];
    for (const name of files) {
      assert.ok(existsSync(path.join(home, name)), `the premise: init made ${name} with the usual umask`);
      await rm(path.join(home, name));
    }

    // Its exit is not held: init writes bot.yaml again after it made it, and
    // under this umask that write is refused. That is the user's file, which
    // keeps the umask's mode (#764's boundary).
    await underUmask(box, '0222', ['init', '--bots', 'bots', '--harness', 'claude']);

    for (const name of files) {
      const at = path.join(home, name);
      assert.ok(existsSync(at), `the control: init made ${at} again, under the umask`);
      assert.equal(octal((await stat(at)).mode), '0444', `${at}, made under umask 0222, keeps the mode the umask gives`);
    }
  });
});

// ------------------------------------------------------------------ U7

describe('U7: under umask 0222, the first up of a bot that is not yet in Orca goes through', { skip: AS_ROOT }, () => {
  /** Nothing is at `<home>/.git`, not even a link. */
  async function assertNoGit(home, why) {
    const at = path.join(home, '.git');
    let there = true;
    try {
      await lstat(at);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      there = false;
    }
    assert.equal(there, false, `${why}: the kit leaves no .git of its own at ${at}`);
  }

  /** Orca has a project at the bot home. */
  async function inOrca(box, home) {
    const real = await realpath(home);
    return (await box.orca.setups()).some((setup) => setup.path === real);
  }

  /** The bot's first session started since `before`: the book holds its tab, Orca has it, and a line typed there names it. */
  async function assertFirstStart(box, bots, bot, before, why) {
    const entry = (await bookIn(bots, bot)).sessions?.daily;
    assert.equal(typeof entry?.tab, 'string', `${why}: the book should hold a tab for ${bot} daily, got ${JSON.stringify(entry)}`);
    const terminal = (await box.orca.terminals()).find((one) => one.tabId === entry.tab);
    assert.ok(terminal, `${why}: Orca should have ${bot} daily's tab ${entry.tab}`);
    const since = typedInto(terminal).slice(before.get(terminal.handle) ?? 0);
    assert.ok(since.some((text) => text.includes(`--bot ${bot} --session daily`)), `${why}: a line that names ${bot} daily should have been typed into its tab, got:\n${since.join('\n')}`);
  }

  test('U7 a Codex bot not yet in Orca, with none of the kit\'s folders there: its first up under umask 0222 goes through, puts its project in Orca, opens its tab with the line typed, and leaves no .git of the kit\'s in the bot home; the same first up of another bot under the usual umask does the same', async (t) => {
    const box = await createSandbox(t);
    await assertPremise(box);
    await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
    const bots = box.path('bots');
    for (const bot of ['web-bot', BOT]) {
      await ok(box, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', 'codex']);
      await ok(box, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
    }

    // The positive control: web-bot's first up, with the usual umask and none of the kit's folders there.
    const control = botHomeOf(bots, 'web-bot');
    await noKitFolders(bots);
    assert.equal(await inOrca(box, control), false, 'the premise: web-bot is not yet in Orca');
    await assertNoGit(control, 'the premise');
    const beforeControl = await typedNow(box);
    await ok(box, ['up', '--bots', 'bots', '--bot', 'web-bot', '--session', 'daily']);
    assert.equal(await inOrca(box, control), true, 'the control: the usual first up puts web-bot\'s project in Orca');
    await assertFirstStart(box, bots, 'web-bot', beforeControl, 'the control: the usual first up');
    await assertNoGit(control, 'the control: the usual first up');

    // api-bot's first up, under umask 0222, with none of the kit's folders there.
    const home = botHomeOf(bots, BOT);
    await noKitFolders(bots);
    assert.equal(await inOrca(box, home), false, `the premise: ${BOT} is not yet in Orca`);
    await assertNoGit(home, 'the premise');
    const before = await typedNow(box);

    const ran = await underUmask(box, '0222', upArgs());

    assert.equal(ran.code, 0, `the first up of ${BOT} under umask 0222 should go through, got exit ${ran.code}:\n${ran.stdout}${ran.stderr}`);
    assert.equal(await inOrca(box, home), true, `the first up under umask 0222 puts ${BOT}'s project in Orca`);
    await assertFirstStart(box, bots, BOT, before, 'the first up under umask 0222');
    await assertNoGit(home, 'the first up under umask 0222');
  });
});
