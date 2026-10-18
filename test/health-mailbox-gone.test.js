// `obk health` names a session whose book names a mailbox Run this Orca does
// not have (issue #508).
//
// A fleet moved to a new machine keeps each book's `mailbox:`, an Orca Run,
// while the Runs stay in the old machine's Orca. Health said nothing about it,
// as it says nothing about a mailbox at all, while it does name a tab the book
// holds and Orca does not have. Since #508 a session's mailbox step replaces a
// Run Orca does not have, so a new start heals it, and health says which start.
//
// What is pinned:
//
//   - For each live session in a book (not a `retired:` entry) whose `mailbox`
//     Orca refuses with `run_not_found` when asked with `run-show`, one
//     finding: kind `session`, the bot, `where` the bot's sessions.yaml, and
//     `says` naming the session, the Run id and the fix. For a session that is
//     not paused the fix is `<cli> restart --bots <bots> --bot <bot> --session
//     <name>`. For a paused session it is `<cli> unpause --bots <bots> --bot
//     <bot> --session <name>`, and for a paused bot `<cli> unpause --bots
//     <bots> --bot <bot>` with no session. The plain lines say what the JSON
//     says.
//   - Nothing when run-show answers the Run (a legacy, inspect-only Run is
//     still there), or fails any other way.
//   - Health fixes nothing and writes nothing; the restart it names does fix
//     it.
//
// The wording is the kit's; the facts are pinned (the session, the Run id, the
// command), with the kit's own CLI and the bots folder matched in either of the
// spellings a shell reads as one word (helpers/cli.js, spellingsOf), as the
// other health tests do. Everything runs through the CLI on a sandboxed bots
// folder against the fake Orca, where a Run "this Orca does not have" is one
// taken out of the fake's `runs`.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookIn,
  bookOf,
  createSandbox,
  orcaCommand,
  sessionIn,
  shellWord,
  skipOrcaFake,
  snapshot,
  spellingsOf,
} from './helpers/cli.js';

/** The kinds a finding can be. */
const KINDS = ['orca', 'config', 'skill', 'session', 'leftover'];

// ---------------------------------------------------------------- the fleet

/** A bots folder with Bot Father up in Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, ...args) {
  const result = await box.run([...args]);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  return result;
}

/** One more bot on `harness`, with these sessions, brought up in Orca by the kit. */
async function botUp(box, name, { harness = 'claude', sessions = ['daily'] } = {}) {
  await obk(box, 'bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness);
  for (const session of sessions) await obk(box, 'session', 'add', '--bots', 'bots', '--bot', name, '--name', session);
  await obk(box, 'up', '--bots', 'bots', '--bot', name);
}

/** A conversation id, shaped the way both harnesses shape one. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** Give every named session of a bot a conversation in the book, so that restart, pause and retire will take it. */
async function conversationsFor(bots, bot, names) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  for (const [n, name] of names.entries()) book.sessions[name].session = conv(50 + n);
  await writeFile(file, stringify(book));
}

/** The mailbox the book names for one session. */
async function mailboxOf(bots, bot, session) {
  const { mailbox } = (await sessionIn(bots, bot, session)) ?? {};
  assert.ok(typeof mailbox === 'string' && mailbox !== '', `the premise: the book names a mailbox for ${bot} ${session}, got: ${mailbox}`);
  return mailbox;
}

/** Take Runs out of the fake Orca: this Orca does not have them, as on a new machine. */
async function goneFromOrca(box, ...ids) {
  const runs = await box.orca.runs();
  for (const id of ids) assert.ok(runs.some((run) => run.id === id), `the premise: Orca had ${id} before`);
  await box.orca.set({ runs: runs.filter((run) => !ids.includes(run.id)) });
}

// ------------------------------------------------------------- the answer

/** Run the health check. */
const health = (box, ...rest) => box.run(['health', '--bots', 'bots', ...rest]);

/**
 * Run the health check for JSON, and hold it to the shape every finding has and
 * to the exit code: 0 when it found nothing, 1 when it found something.
 */
async function found(box, ...rest) {
  const result = await health(box, ...rest, '--json');
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  for (const finding of answer.found) {
    assert.ok(KINDS.includes(finding.kind), `a finding's kind is one of ${KINDS.join(', ')}, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.where === 'string' && finding.where.trim() !== '', `a finding says what it is about, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.says === 'string' && finding.says.trim() !== '', `a finding says something, got: ${JSON.stringify(finding)}`);
  }
  assert.equal(
    result.code,
    answer.found.length === 0 ? 0 : 1,
    `${answer.found.length} findings should exit ${answer.found.length === 0 ? 0 : 1}, got ${result.code}`,
  );
  return answer;
}

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The findings that name `what`, as a word of its own, anywhere a reader would see it. */
const naming = (answer, what) => answer.found.filter((one) => hasWord(wordsOf(one), what));

/** Every run of whitespace as one space, so an indented or re-wrapped sentence still reads the same. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** Each way the kit may spell `<cli> <verb> --bots <bots> --bot <bot>`. */
const commandsOf = (box, bots, verb, bot) => spellingsOf(box.cli)
  .flatMap((cli) => spellingsOf(bots).map((folder) => `${cli} ${verb} --bots ${folder} --bot ${bot}`));

/**
 * The one finding that names `run`, a mailbox Orca does not have, for one
 * session of one bot: kind `session`, the bot, the bot's book as `where`, and
 * the session named.
 */
function assertNamedGone(answer, bots, bot, session, run) {
  const mine = naming(answer, run);
  assert.equal(mine.length, 1, `one finding names ${bot} ${session}'s mailbox ${run}, which Orca does not have, got: ${JSON.stringify(answer.found, null, 2)}`);
  const [finding] = mine;
  assert.equal(finding.kind, 'session', `it is a finding about a session, got: ${JSON.stringify(finding)}`);
  assert.equal(finding.bot, bot, `about ${bot}, got: ${JSON.stringify(finding)}`);
  assert.equal(finding.where, bookOf(bots, bot), `it points at the book that names the Run, got: ${JSON.stringify(finding)}`);
  assert.ok(hasWord(finding.says, session), `it names the session, got: ${finding.says}`);
  assert.ok(finding.says.includes(run), `and the Run, got: ${finding.says}`);
  return finding;
}

/** Whether `says` gives `<cli> <verb> --bots <bots> --bot <bot> --session <session>`. */
const givesFor = (says, box, bots, verb, bot, session) =>
  commandsOf(box, bots, verb, bot).some((command) => hasWord(says, `${command} --session ${session}`));

/** Whether `says` gives the command with no `--session` after it: the whole bot. */
const givesForTheBot = (says, box, bots, verb, bot) => commandsOf(box, bots, verb, bot).some((command) => {
  const at = says.indexOf(command);
  return at >= 0 && !says.slice(at + command.length).trimStart().startsWith('--session');
});

/** Whether `says` gives any `<cli> <verb> ` at all. */
const givesAny = (says, box, verb) => spellingsOf(box.cli).some((cli) => says.includes(`${cli} ${verb} `));

// ---------------------------------------------------------------------------
// The finding, and its fix
// ---------------------------------------------------------------------------

test('#508 4: a session whose mailbox Orca does not have is named with its Run, its book and its restart, and its sibling is not', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  const gone = await mailboxOf(bots, 'api-bot', 'daily');
  const kept = await mailboxOf(bots, 'api-bot', 'review');
  await goneFromOrca(box, gone);

  const answer = await found(box);

  const finding = assertNamedGone(answer, bots, 'api-bot', 'daily', gone);
  assert.ok(
    givesFor(finding.says, box, bots, 'restart', 'api-bot', 'daily'),
    `the fix is the kit's own restart of that session, ${shellWord(box.cli)} restart --bots ${shellWord(bots)} --bot api-bot --session daily, got: ${finding.says}`,
  );
  assert.deepEqual(naming(answer, kept), [], 'review\'s mailbox is one Orca has: nothing names it');
  assert.deepEqual(naming(answer, await mailboxOf(bots, 'bot-father', 'daily')), [], 'nor Bot Father\'s');
});

test('#508 4: the plain report says what the JSON says about a mailbox Orca does not have', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const gone = await mailboxOf(bots, 'api-bot', 'daily');
  await goneFromOrca(box, gone);

  const answer = await found(box);
  const plain = await health(box);

  const finding = assertNamedGone(answer, bots, 'api-bot', 'daily', gone);
  assert.equal(plain.code, 1, `the plain run finds the same, got: ${plain.stdout}${plain.stderr}`);
  assert.equal(plain.stderr, '');
  assert.ok(
    plain.stdout.split('\n').some((line) => line.includes(finding.kind) && line.includes(finding.where)),
    `one plain line holds the finding's kind and where, got:\n${plain.stdout}`,
  );
  assert.ok(flat(plain.stdout).includes(flat(finding.says)), `and the plain lines say what the JSON says, got:\n${plain.stdout}`);
});

test('#508 4: a paused session whose mailbox Orca does not have is named with its unpause, not a restart', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  const gone = await mailboxOf(bots, 'api-bot', 'daily');
  await goneFromOrca(box, gone);

  const answer = await found(box);

  const finding = assertNamedGone(answer, bots, 'api-bot', 'daily', gone);
  assert.ok(
    givesFor(finding.says, box, bots, 'unpause', 'api-bot', 'daily'),
    `the fix is the kit's own unpause of that session, ${shellWord(box.cli)} unpause --bots ${shellWord(bots)} --bot api-bot --session daily, got: ${finding.says}`,
  );
  assert.ok(!givesAny(finding.says, box, 'restart'), `and not a restart, which is not how a paused session comes back, got: ${finding.says}`);
});

test('#508 4: a session of a paused bot whose mailbox Orca does not have is named with the bot\'s unpause', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot');
  const gone = await mailboxOf(bots, 'api-bot', 'daily');
  await goneFromOrca(box, gone);

  const answer = await found(box);

  const finding = assertNamedGone(answer, bots, 'api-bot', 'daily', gone);
  assert.ok(
    givesForTheBot(finding.says, box, bots, 'unpause', 'api-bot'),
    `the fix is the kit's own unpause of the bot, ${shellWord(box.cli)} unpause --bots ${shellWord(bots)} --bot api-bot, with no --session, got: ${finding.says}`,
  );
  assert.ok(!givesAny(finding.says, box, 'restart'), `and not a restart, got: ${finding.says}`);
});

/** Where in `says` the first of `commands` begins that `ok` accepts there, or -1. */
function firstAt(says, commands, ok = () => true) {
  const at = [];
  for (const command of commands) {
    for (let from = says.indexOf(command); from >= 0; from = says.indexOf(command, from + 1)) {
      if (ok(says.slice(from + command.length))) at.push(from);
    }
  }
  return at.length === 0 ? -1 : Math.min(...at);
}

test('#508 4: a paused session of a paused bot whose mailbox Orca does not have is named with the bot\'s unpause and then the session\'s', async (t) => {
  // `obk unpause --bot` takes off the bot's mark only; the session's own mark
  // stays, and it stays paused. So both unpauses are the fix, the bot's first.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot');
  const gone = await mailboxOf(bots, 'api-bot', 'daily');
  await goneFromOrca(box, gone);

  const answer = await found(box);

  const { says } = assertNamedGone(answer, bots, 'api-bot', 'daily', gone);
  const commands = commandsOf(box, bots, 'unpause', 'api-bot');
  const theBot = firstAt(says, commands, (rest) => !rest.trimStart().startsWith('--session'));
  const theSession = firstAt(says, commands, (rest) => /^ --session daily($|[^A-Za-z0-9_-])/.test(rest));
  assert.ok(theBot >= 0, `the bot's unpause, ${shellWord(box.cli)} unpause --bots ${shellWord(bots)} --bot api-bot, with no --session, got: ${says}`);
  assert.ok(theSession >= 0, `and the session's, ${shellWord(box.cli)} unpause --bots ${shellWord(bots)} --bot api-bot --session daily, got: ${says}`);
  assert.ok(theBot < theSession, `the bot's unpause first, then the session's, got: ${says}`);
  assert.ok(!givesAny(says, box, 'restart'), `and not a restart, got: ${says}`);
});

// ---------------------------------------------------------------------------
// Nothing when Orca has the Run, or will not say
// ---------------------------------------------------------------------------

test('#508 4: a legacy Run Orca still answers for is not named, beside a Run Orca does not have, which is', async (t) => {
  // run-use would refuse the legacy Run, but run-show answers it: Orca has it.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  const legacy = await mailboxOf(bots, 'api-bot', 'daily');
  const gone = await mailboxOf(bots, 'api-bot', 'review');
  await goneFromOrca(box, gone);
  await box.orca.set({ runs: (await box.orca.runs()).map((run) => (run.id === legacy ? { ...run, legacy: 1, coordinator_handle: null } : run)) });

  const answer = await found(box);

  assertNamedGone(answer, bots, 'api-bot', 'review', gone);
  assert.deepEqual(naming(answer, legacy), [], `Orca answers for ${legacy}: nothing names it, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('#508 4: a mailbox is not named when Orca refuses run-show for another reason', async (t) => {
  // A busy Orca is not proof the Run is gone.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const gone = await mailboxOf(bots, 'api-bot', 'daily');
  await goneFromOrca(box, gone);
  await box.orca.set({
    fail: { 'orchestration run-show': { code: 'runtime_error', message: 'the orchestration runtime is restarting; try again in a moment' } },
  });

  const answer = await found(box);

  assert.deepEqual(naming(answer, gone), [], `Orca did not say ${gone} is gone: nothing names it, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('#508 4: a retired session\'s mailbox Orca does not have is not named, beside a live one that is', async (t) => {
  // `retired:` is history (ADR 0012): nothing will start that session again,
  // so its mailbox needs no fix.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  const retiredRun = await mailboxOf(bots, 'api-bot', 'review');
  await obk(box, 'retire', '--bots', 'bots', '--bot', 'api-bot', '--session', 'review');
  const book = await bookIn(bots, 'api-bot');
  assert.ok(
    (book.retired ?? []).some((entry) => entry.mailbox === retiredRun),
    `the premise: the book keeps review's mailbox under retired, got: ${JSON.stringify(book.retired)}`,
  );
  const gone = await mailboxOf(bots, 'api-bot', 'daily');
  await goneFromOrca(box, gone, retiredRun);

  const answer = await found(box);

  assertNamedGone(answer, bots, 'api-bot', 'daily', gone);
  assert.deepEqual(naming(answer, retiredRun), [], `the retired session's mailbox is not named, got: ${JSON.stringify(answer.found, null, 2)}`);
});

// ---------------------------------------------------------------------------
// Health only reads, and the restart it names heals it
// ---------------------------------------------------------------------------

test('#508 4: health names a mailbox Orca does not have and changes nothing: no file, no Run, and no Run made or bound', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const gone = await mailboxOf(bots, 'api-bot', 'daily');
  await goneFromOrca(box, gone);
  const before = await snapshot(box.root, skipOrcaFake);
  const runs = await box.orca.runs();
  const terminals = await box.orca.terminals();
  const asked = (await box.orca.calls()).length;

  const answer = await found(box);
  await health(box);

  assertNamedGone(answer, bots, 'api-bot', 'daily', gone);
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'every file and every link is as it was: the book still names the Run');
  assert.deepEqual(await box.orca.runs(), runs, 'no Run made, bound or changed');
  assert.deepEqual(await box.orca.terminals(), terminals, 'no tab opened, closed or typed into');
  // `orchestration inbox` reads each live session's mailbox for mail that waits unannounced (#630).
  const orchestration = [...new Set((await box.orca.calls()).slice(asked).map(orcaCommand))].filter((command) => command.startsWith('orchestration ')).sort();
  assert.deepEqual(orchestration, ['orchestration inbox', 'orchestration run-show'], 'of the mailbox calls, health only asks to see a Run and to read its mail');
});

test('#508 4: after the restart health names, the session has a mailbox Orca has, bound to its new tab, and the finding is gone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { harness: 'codex' });
  await conversationsFor(bots, 'api-bot', ['daily']);
  const gone = await mailboxOf(bots, 'api-bot', 'daily');
  await goneFromOrca(box, gone);
  const finding = assertNamedGone(await found(box), bots, 'api-bot', 'daily', gone);
  assert.ok(givesFor(finding.says, box, bots, 'restart', 'api-bot', 'daily'), `the premise: it names the restart, got: ${finding.says}`);

  await obk(box, 'restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.notEqual(daily.mailbox, gone, `the book names a new mailbox, got: ${JSON.stringify(daily)}`);
  const run = (await box.orca.runs()).find((one) => one.id === daily.mailbox);
  assert.ok(run !== undefined, `and Orca has it, got: ${JSON.stringify(daily)}`);
  const tab = (await box.orca.terminals()).find((one) => one.tabId === daily.tab);
  assert.equal(run.coordinator_handle, tab?.handle, 'bound to the session\'s new tab');
  const after = await found(box);
  assert.deepEqual(naming(after, gone), [], `nothing names the old Run any more, got: ${JSON.stringify(after.found, null, 2)}`);
  assert.deepEqual(naming(after, daily.mailbox), [], `nor the new one, got: ${JSON.stringify(after.found, null, 2)}`);
});
