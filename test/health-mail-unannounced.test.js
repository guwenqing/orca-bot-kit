// `obk health` names a session whose mail waits unread and unannounced (#630).
//
// Fleet mail goes into a session's Orca mailbox, a Run the book names as
// `mailbox: run_<id>`, and Orca types a notice into the session's tab. On the
// owner's machine Orca stopped giving that notice to five live sessions for
// days, and health said nothing. The cause is in Orca (tech notes, #630), so
// the kit cannot fix it; health names each such session and says what to run.
//
// What is pinned:
//
//   1. Health reads the mailbox of each session in a book (temporary ones
//      too, `retired:` entries not) that has a `mailbox`, whose tab Orca lists,
//      and that is not paused, nor its bot.
//   2. A letter waits when `read` is 0, `delivered_at` is null and `created_at`
//      is more than an hour ago. Clear cases only: 2 hours and more waits, 10
//      minutes does not. The exact boundary is not pinned.
//   3. A session with letters waiting gets one finding, however many letters:
//      kind `mail`, `bot` the bot, `where` the Run id as the book writes it,
//      and `says` naming the session, the number of waiting letters, the
//      `created_at` of the oldest waiting letter as Orca gave it, the fix
//      `<cli> restart --bots <bots> --bot <bot> --session <name>`, and that the
//      harness is idle now (a loose match on "idle").
//   4. Nothing when the only unread letters are newer than an hour, when old
//      letters have `read` 1 (a session read them with `obk message check`
//      and had no notice), or when old unread letters have `delivered_at` set.
//   5. Nothing about mail for a paused session, a session of a paused bot, or
//      a session whose tab Orca does not list. Whether health reads those
//      mailboxes is left to the kit; each one here holds old waiting letters,
//      so a finding would show it judged them.
//   6. When Orca refuses or fails the read, nothing about that session's mail;
//      everything else is still reported, and health does not crash.
//   7. Health only reads: no `orchestration check`, `run-use`, `run-create` or
//      `send`, and nothing typed into a tab.
//   8. The plain report says what the JSON says.
//   9. Busy is not stuck: Orca waits until a harness is idle to give its
//      notice. So a finding comes only when the session's harness is idle now,
//      as `obk message send --interrupt` reads a tab: Orca's tui-idle wait
//      answers ok, the harness is in front, and no question is on its screen.
//      Busy (the wait times out), blocked, a question on the screen, or only a
//      shell in front: no finding.
//  10. Health reads flags and times only: no letter's subject or body shows
//      in either report.
//
// Each case that says "nothing" has a session beside it that is named, so a
// health that names nothing at all fails it too.
//
// The wording is the kit's; the facts are pinned, with the kit's own CLI and
// the bots folder matched in either of the spellings a shell reads as one word
// (helpers/cli.js, spellingsOf), as the other health tests do. Everything runs
// through the CLI on a sandboxed bots folder against the fake Orca, whose
// `inbox` holds what `orchestration inbox --terminal run:<id>` answers for a
// Run (helpers/fake-orca.js).

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertOrcaCallsAllowed,
  bookIn,
  bookOf,
  createSandbox,
  kitLaunchMark,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  sessionIn,
  shellWord,
  skipOrcaFake,
  snapshot,
  spellingsOf,
} from './helpers/cli.js';
import { CLAUDE_TEACH_FORM, CODEX_UPDATE_OFFER } from './helpers/screens.js';

/** The kinds a finding can be: the ones before #630, and `mail`. */
const KINDS = ['orca', 'config', 'skill', 'session', 'leftover', 'mail'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ---------------------------------------------------------------- the fleet

/** A bots folder with Bot Father up in Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  return result;
}

/** One more bot on `harness`, with these sessions, brought up in Orca by the kit. */
async function botUp(box, name, { harness = 'claude', sessions = ['daily'] } = {}) {
  await obk(box, ['bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness]);
  for (const session of sessions) await obk(box, ['session', 'add', '--bots', 'bots', '--bot', name, '--name', session]);
  await obk(box, ['up', '--bots', 'bots', '--bot', name]);
}

/** A conversation id, shaped the way both harnesses shape one. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** Give every named session of a bot a conversation in the book, so that pause and retire will take it. */
async function conversationsFor(bots, bot, names) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  for (const [n, name] of names.entries()) book.sessions[name].session = conv(50 + n);
  await writeFile(file, stringify(book));
}

/** The mailbox the book names for one session. */
async function mailboxOf(bots, bot, session) {
  const { mailbox } = (await sessionIn(bots, bot, session)) ?? {};
  assert.ok(typeof mailbox === 'string' && /^run_/.test(mailbox), `the premise: the book names a mailbox for ${bot} ${session}, got: ${mailbox}`);
  return mailbox;
}

/** Orca's own record of the tab the book holds for one session. */
async function terminalOf(box, bots, bot, session) {
  const { tab } = (await sessionIn(bots, bot, session)) ?? {};
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(terminal !== undefined, `the premise: Orca lists ${bot} ${session}'s tab ${tab}`);
  return terminal;
}

/** Change one tab in the fake Orca's world, as test/mail-interrupt.test.js does. */
async function setTab(box, terminal, changes) {
  await box.orca.set({ terminals: (await box.orca.terminals()).map((one) => (one.handle === terminal.handle ? { ...one, ...changes } : one)) });
}

/** Put tabs back into Orca's listing, as Orca had them: a pause or retire closed them. */
async function stillListed(box, ...terminals) {
  const now = await box.orca.terminals();
  const back = terminals.filter((terminal) => !now.some((one) => one.handle === terminal.handle));
  await box.orca.set({ terminals: [...now, ...back] });
}

// ------------------------------------------------------------- the letters

let sequence = 0;

/** A time as Orca writes it: whole seconds, then Z. */
const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The subject and body of every letter, unless a test gives its own. */
const SUBJECT = 'zq-subject-plum-7731';
const BODY = 'zq-body-quince-4410';

/**
 * One letter in a Run's mailbox, as `orchestration inbox` answers it: every
 * column Orca 1.4.225 gave (seen live, 2026-10-17). `read`, `delivered_at`,
 * `created_at`, `to_handle`, `run_id` and `sequence` have the shapes seen
 * there; the values of the other columns were not written down, and the ones
 * here stand in for them. `age` is how long before now it was written;
 * `delivered` puts a `delivered_at` a minute after that.
 */
function letter(run, { age, read = 0, delivered = false, subject = SUBJECT, body = BODY }) {
  sequence += 1;
  const at = Date.now() - age;
  return {
    body,
    created_at: stamp(at),
    delivered_at: delivered ? stamp(at + MINUTE) : null,
    delivery_contract: null,
    from_handle: 'term_sender',
    id: `msg_mail_${sequence}`,
    payload: null,
    pointer_enter_pending: 0,
    pointer_process_incarnation: null,
    pointer_pty_id: null,
    priority: 'normal',
    read,
    run_id: run,
    sender_pane_key: null,
    sequence,
    subject,
    thread_id: null,
    to_handle: `run:${run}`,
    type: 'status',
  };
}

/** Put letters into a Run's mailbox, beside any it holds. */
async function mailTo(box, run, ...letters) {
  const inbox = (await box.orca.state()).inbox ?? {};
  await box.orca.set({ inbox: { ...inbox, [run]: [...(inbox[run] ?? []), ...letters] } });
  return letters;
}

/** One letter that waits: unread, never rung, two hours old. */
const waiting = (run) => letter(run, { age: 2 * HOUR });

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
  return { ...answer, stdout: result.stdout };
}

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** Every run of whitespace as one space, so an indented or re-wrapped sentence still reads the same. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** The findings about mail. */
const mailFindings = (answer) => answer.found.filter((one) => one.kind === 'mail');

/** Whether `says` gives `<cli> restart --bots <bots> --bot <bot> --session <session>`. */
const givesRestart = (says, box, bots, bot, session) => spellingsOf(box.cli)
  .flatMap((cli) => spellingsOf(bots).map((folder) => `${cli} restart --bots ${folder} --bot ${bot} --session ${session}`))
  .some((command) => hasWord(says, command));

/**
 * The one finding about `run`'s waiting mail, for one session of one bot:
 * kind `mail`, the bot, the Run as `where`, the session named, its restart
 * given, and the harness said to be idle.
 */
function assertNamedMail(answer, box, bots, bot, session, run) {
  const mine = answer.found.filter((one) => one.kind === 'mail' && one.where === run);
  assert.equal(
    mine.length,
    1,
    `one finding of kind mail, where ${run}, about ${bot} ${session}'s waiting mail, got: ${JSON.stringify(answer.found, null, 2)}`,
  );
  const [finding] = mine;
  assert.equal(finding.bot, bot, `about ${bot}, got: ${JSON.stringify(finding)}`);
  assert.ok(hasWord(finding.says, session), `it names the session ${session}, got: ${finding.says}`);
  assert.ok(
    givesRestart(finding.says, box, bots, bot, session),
    `the fix is the kit's own restart of that session, ${shellWord(box.cli)} restart --bots ${shellWord(bots)} --bot ${bot} --session ${session}, got: ${finding.says}`,
  );
  assert.match(finding.says, /idle/i, `it says the session's harness is idle now, got: ${finding.says}`);
  return finding;
}

/** Nothing about `run`'s mail: no mail finding is about it, and no mail finding names it. */
function assertNoMailFor(answer, run, why) {
  const about = mailFindings(answer).filter((one) => one.where === run || hasWord(wordsOf(one), run));
  assert.deepEqual(about, [], `${why}: no mail finding about ${run}, got: ${JSON.stringify(answer.found, null, 2)}`);
}

// ---------------------------------------------------------------------------
// 3. The finding
// ---------------------------------------------------------------------------

for (const harness of ['claude', 'codex']) {
  test(`#630 3: a ${harness} session with waiting letters is named once, with how many wait, the oldest one's time, its restart and that it is idle`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { harness, sessions: ['daily', 'review'] });
    const daily = await mailboxOf(bots, 'api-bot', 'daily');
    const review = await mailboxOf(bots, 'api-bot', 'review');
    // Three wait. Beside them: one too new, one read, one rung, each of which
    // a wrong count or a wrong "oldest" would take in.
    const [, , oldestWaiting] = await mailTo(
      box,
      daily,
      letter(daily, { age: 2 * HOUR }),
      letter(daily, { age: 3 * HOUR }),
      letter(daily, { age: 5 * HOUR }),
    );
    const [, read, rung] = await mailTo(
      box,
      daily,
      letter(daily, { age: 10 * MINUTE }),
      letter(daily, { age: 26 * HOUR, read: 1 }),
      letter(daily, { age: 30 * HOUR, delivered: true }),
    );
    await mailTo(box, review, waiting(review));

    const answer = await found(box);

    const finding = assertNamedMail(answer, box, bots, 'api-bot', 'daily', daily);
    assert.ok(hasWord(finding.says, '3'), `it says 3 letters wait, got: ${finding.says}`);
    assert.ok(!hasWord(finding.says, '4') && !hasWord(finding.says, '6'), `not 4 (every unread one) nor 6 (every one), got: ${finding.says}`);
    assert.ok(
      finding.says.includes(oldestWaiting.created_at),
      `it gives the oldest waiting letter's created_at as Orca gave it, ${oldestWaiting.created_at}, got: ${finding.says}`,
    );
    assert.ok(
      !finding.says.includes(read.created_at) && !finding.says.includes(rung.created_at),
      `the older letters that were read or rung do not wait, so neither of their times is the oldest, got: ${finding.says}`,
    );
    assertNamedMail(answer, box, bots, 'api-bot', 'review', review);
    assert.equal(mailFindings(answer).length, 2, `one finding for each of the two sessions, not one for each letter, got: ${JSON.stringify(answer.found, null, 2)}`);
    assertNoMailFor(answer, await mailboxOf(bots, 'bot-father', 'daily'), 'Bot Father\'s mailbox is empty');
  });
}

test('#630 8: the plain report says what the JSON says about waiting mail', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  await mailTo(box, daily, waiting(daily), letter(daily, { age: 4 * HOUR }));

  const answer = await found(box);
  const plain = await health(box);

  const finding = assertNamedMail(answer, box, bots, 'api-bot', 'daily', daily);
  assert.equal(plain.code, 1, `the plain run finds the same, got: ${plain.stdout}${plain.stderr}`);
  assert.equal(plain.stderr, '');
  assert.ok(
    plain.stdout.split('\n').some((line) => line.includes(finding.kind) && line.includes(finding.where)),
    `one plain line holds the finding's kind and where, got:\n${plain.stdout}`,
  );
  assert.ok(flat(plain.stdout).includes(flat(finding.says)), `and the plain lines say what the JSON says, got:\n${plain.stdout}`);
});

test('#630 10: neither report shows a waiting letter\'s subject or body', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  const review = await mailboxOf(bots, 'api-bot', 'review');
  await mailTo(box, daily, waiting(daily), letter(daily, { age: 3 * HOUR, subject: 'zq-subject-damson-2290', body: 'zq-body-medlar-5518' }));
  await mailTo(box, review, letter(review, { age: 10 * MINUTE, subject: 'zq-subject-sloe-0613', body: 'zq-body-rowan-9047' }));

  const json = await health(box, '--json');
  const plain = await health(box);

  assertNamedMail(JSON.parse(json.stdout), box, bots, 'api-bot', 'daily', daily);
  for (const [name, result] of [['--json', json], ['plain', plain]]) {
    const all = `${result.stdout}${result.stderr}`;
    for (const secret of [SUBJECT, BODY, 'zq-subject-damson-2290', 'zq-body-medlar-5518', 'zq-subject-sloe-0613', 'zq-body-rowan-9047']) {
      assert.ok(!all.includes(secret), `the ${name} report reads flags and times only, and shows ${secret}:\n${all}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2, 4. Which letters wait
// ---------------------------------------------------------------------------

const NOT_WAITING = {
  'unread letters ten minutes old, newer than an hour': (run) => [letter(run, { age: 10 * MINUTE }), letter(run, { age: 12 * MINUTE })],
  'old letters the session read itself (read 1, no delivered_at)': (run) => [letter(run, { age: 3 * HOUR, read: 1 }), letter(run, { age: 30 * HOUR, read: 1 })],
  'old unread letters whose notice went in (delivered_at set)': (run) => [letter(run, { age: 3 * HOUR, delivered: true }), letter(run, { age: 30 * HOUR, delivered: true })],
};

for (const [label, letters] of Object.entries(NOT_WAITING)) {
  test(`#630 4: a session with only ${label} is not named; its sibling with a waiting letter is`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
    const daily = await mailboxOf(bots, 'api-bot', 'daily');
    const review = await mailboxOf(bots, 'api-bot', 'review');
    await mailTo(box, daily, ...letters(daily));
    await mailTo(box, review, waiting(review));

    const answer = await found(box);

    assertNamedMail(answer, box, bots, 'api-bot', 'review', review);
    assertNoMailFor(answer, daily, `daily has ${label}: none waits`);
  });
}

// ---------------------------------------------------------------------------
// 1, 5. Whose mailbox counts
// ---------------------------------------------------------------------------

test('#630 1: a temporary session in the book with waiting letters is named with its own restart', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const maker = await terminalOf(box, bots, 'api-bot', 'daily');
  await obk(
    box,
    ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Look into the staging host.'],
    { env: { ...box.env, ORCA_TERMINAL_HANDLE: maker.handle, ORCA_TAB_ID: maker.tabId, ...kitLaunchMark(box, maker) } },
  );
  const scoutEntry = await sessionIn(bots, 'api-bot', 'scout');
  assert.ok(scoutEntry?.temporary != null, `the premise: the book holds scout as a temporary session, got: ${JSON.stringify(scoutEntry)}`);
  await terminalOf(box, bots, 'api-bot', 'scout');
  const scout = await mailboxOf(bots, 'api-bot', 'scout');
  await mailTo(box, scout, waiting(scout));

  const answer = await found(box);

  assertNamedMail(answer, box, bots, 'api-bot', 'scout', scout);
  assertNoMailFor(answer, await mailboxOf(bots, 'api-bot', 'daily'), 'the maker\'s mailbox is empty');
});

test('#630 1: a retired session\'s mailbox with old unread letters is not named, beside a live one that is', async (t) => {
  // `retired:` is history (ADR 0012): nothing reads that mailbox any more.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  const retiredRun = await mailboxOf(bots, 'api-bot', 'review');
  const retiredTab = await terminalOf(box, bots, 'api-bot', 'review');
  await obk(box, ['retire', '--bots', 'bots', '--bot', 'api-bot', '--session', 'review']);
  const book = await bookIn(bots, 'api-bot');
  assert.ok(
    (book.retired ?? []).some((entry) => entry.mailbox === retiredRun),
    `the premise: the book keeps review's mailbox under retired, got: ${JSON.stringify(book.retired)}`,
  );
  // Orca still lists its tab, so only the book's word that it is retired keeps it out.
  await stillListed(box, retiredTab);
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  await mailTo(box, daily, waiting(daily));
  await mailTo(box, retiredRun, waiting(retiredRun));

  const answer = await found(box);

  assertNamedMail(answer, box, bots, 'api-bot', 'daily', daily);
  assertNoMailFor(answer, retiredRun, 'review is retired');
});

test('#630 5: a paused session with old waiting letters is not named about mail, beside a live one that is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  const pausedTab = await terminalOf(box, bots, 'api-bot', 'daily');
  await obk(box, ['pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);
  // Orca still lists its tab, so only the pause keeps it out.
  await stillListed(box, pausedTab);
  const paused = await mailboxOf(bots, 'api-bot', 'daily');
  const review = await mailboxOf(bots, 'api-bot', 'review');
  await mailTo(box, paused, waiting(paused), letter(paused, { age: 30 * HOUR }));
  await mailTo(box, review, waiting(review));

  const answer = await found(box);

  assertNamedMail(answer, box, bots, 'api-bot', 'review', review);
  assertNoMailFor(answer, paused, 'daily is paused');
});

test('#630 5: a session of a paused bot with old waiting letters is not named about mail, beside another bot\'s that is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await botUp(box, 'web-bot');
  await conversationsFor(bots, 'web-bot', ['daily']);
  const pausedTab = await terminalOf(box, bots, 'web-bot', 'daily');
  await obk(box, ['pause', '--bots', 'bots', '--bot', 'web-bot']);
  await stillListed(box, pausedTab);
  const paused = await mailboxOf(bots, 'web-bot', 'daily');
  const live = await mailboxOf(bots, 'api-bot', 'daily');
  await mailTo(box, paused, waiting(paused), letter(paused, { age: 30 * HOUR }));
  await mailTo(box, live, waiting(live));

  const answer = await found(box);

  assertNamedMail(answer, box, bots, 'api-bot', 'daily', live);
  assertNoMailFor(answer, paused, 'web-bot is paused');
});

test('#630 5: a session whose tab Orca does not list is not named about mail, beside one whose tab it lists', async (t) => {
  // Health names the missing tab in a finding of its own (H14 in health.test.js).
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  const gone = await terminalOf(box, bots, 'api-bot', 'daily');
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.handle !== gone.handle) });
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  const review = await mailboxOf(bots, 'api-bot', 'review');
  await mailTo(box, daily, waiting(daily), letter(daily, { age: 30 * HOUR }));
  await mailTo(box, review, waiting(review));

  const answer = await found(box);

  assertNamedMail(answer, box, bots, 'api-bot', 'review', review);
  assertNoMailFor(answer, daily, 'daily has no tab in Orca\'s listing');
});

// ---------------------------------------------------------------------------
// 9. Only an idle harness's waiting mail is stuck
// ---------------------------------------------------------------------------

/** The tabs whose waiting mail is not named, and how the fake Orca shows each. */
const NOT_IDLE = {
  'a busy harness (Orca\'s tui-idle wait times out)': () => ({ tuiIdle: 'busy' }),
  'something Orca says is blocked, waiting to be answered': () => ({ tuiIdle: 'blocked' }),
  'a question of its harness\'s own on its screen, while Orca\'s wait answers ok': (harness) => ({
    screen: harness === 'codex' ? CODEX_UPDATE_OFFER : CLAUDE_TEACH_FORM,
  }),
  'only a shell in front, while Orca\'s wait answers ok': () => ({ tuiIdle: 'quit', foreground: 'shell' }),
};

for (const harness of ['claude', 'codex']) {
  for (const [label, tab] of Object.entries(NOT_IDLE)) {
    test(`#630 9: a ${harness} session with old waiting letters and ${label} is not named; its idle sibling is`, async (t) => {
      const box = await createSandbox(t);
      const bots = await seeded(box);
      await botUp(box, 'api-bot', { harness, sessions: ['daily', 'review'] });
      await setTab(box, await terminalOf(box, bots, 'api-bot', 'daily'), tab(harness));
      const daily = await mailboxOf(bots, 'api-bot', 'daily');
      const review = await mailboxOf(bots, 'api-bot', 'review');
      await mailTo(box, daily, waiting(daily), letter(daily, { age: 30 * HOUR }));
      await mailTo(box, review, waiting(review));

      const answer = await found(box);

      assertNamedMail(answer, box, bots, 'api-bot', 'review', review);
      assertNoMailFor(answer, daily, `daily's tab holds ${label}: Orca waits for it to be idle`);
    });
  }
}

// ---------------------------------------------------------------------------
// 6. A read Orca refuses or fails
// ---------------------------------------------------------------------------

test('#630 6: a mailbox read Orca refuses gives nothing about that session\'s mail; the rest is still reported, and a failing Orca crashes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review', 'lost'] });
  const runs = {
    'bot-father daily': await mailboxOf(bots, 'bot-father', 'daily'),
    'api-bot daily': await mailboxOf(bots, 'api-bot', 'daily'),
    'api-bot review': await mailboxOf(bots, 'api-bot', 'review'),
  };
  for (const run of Object.values(runs)) await mailTo(box, run, waiting(run));
  // Something else for health to report: a tab Orca does not list.
  const lost = await terminalOf(box, bots, 'api-bot', 'lost');
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.handle !== lost.handle) });

  // The first mailbox read of the next run is refused, and the ones after it answer.
  const asked = (await box.orca.calls()).length;
  const readsBefore = orcaCallsOf(await box.orca.calls(), 'orchestration inbox').length;
  await box.orca.set({
    fail: { 'orchestration inbox': { code: 'runtime_error', message: 'the orchestration runtime is restarting; try again in a moment', after: readsBefore, times: 1 } },
  });

  const answer = await found(box);

  const reads = orcaCallsOf((await box.orca.calls()).slice(asked), 'orchestration inbox');
  assert.ok(reads.length > 0, 'health reads the live sessions\' mailboxes with orchestration inbox, and read none');
  const refused = orcaFlag(reads[0], '--terminal')?.replace(/^run:/, '');
  // A health that reads the lost session's mailbox too may have that read refused; then all three are named.
  const lostRun = await mailboxOf(bots, 'api-bot', 'lost');
  assert.ok([...Object.values(runs), lostRun].includes(refused), `the premise: the refused read was of a mailbox a book names, got: ${refused}`);
  assertNoMailFor(answer, refused, 'Orca refused that read');
  for (const [who, run] of Object.entries(runs)) {
    if (run === refused) continue;
    const [bot, session] = who.split(' ');
    assertNamedMail(answer, box, bots, bot, session, run);
  }
  assert.ok(
    answer.found.some((one) => one.kind === 'session' && one.bot === 'api-bot' && hasWord(wordsOf(one), lost.tabId)),
    `the tab Orca does not list is still reported, got: ${JSON.stringify(answer.found, null, 2)}`,
  );

  // Every read refused, and then every read failing outright: no JSON and a bad exit.
  for (const breaks of [
    { fail: { 'orchestration inbox': { code: 'runtime_error', message: 'the orchestration runtime is restarting; try again in a moment' } } },
    { fail: {}, crash: { command: 'orchestration inbox', exitCode: 1, stdout: '', stderr: 'orca: something went wrong\n' } },
  ]) {
    await box.orca.set(breaks);
    const all = await found(box);
    assert.deepEqual(mailFindings(all), [], `no read answered, so nothing about mail, got: ${JSON.stringify(all.found, null, 2)}`);
    assert.ok(all.found.some((one) => one.kind === 'session' && hasWord(wordsOf(one), lost.tabId)), `the lost tab is still reported, got: ${JSON.stringify(all.found, null, 2)}`);
    const plain = await health(box);
    assert.equal(plain.code, 1, `the plain run reports the lost tab and exits 1, got: ${plain.code}\n${plain.stdout}${plain.stderr}`);
    assert.ok(plain.stdout.includes(lost.tabId), `the plain run names the lost tab, got:\n${plain.stdout}`);
    assert.doesNotMatch(plain.stderr, /\n\s+at |TypeError|ReferenceError|SyntaxError|RangeError/, `health does not crash, got:\n${plain.stderr}`);
  }
});

// ---------------------------------------------------------------------------
// 7. Health only reads
// ---------------------------------------------------------------------------

test('#630 7: health names waiting mail and changes nothing: no file, no tab, no Run, no letter, and no read that takes mail', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  await mailTo(box, daily, waiting(daily), letter(daily, { age: 10 * MINUTE }));
  const before = await snapshot(box.root, skipOrcaFake);
  const state = await box.orca.state();
  const asked = (await box.orca.calls()).length;

  const answer = await found(box);
  await health(box);

  assertNamedMail(answer, box, bots, 'api-bot', 'daily', daily);
  const after = await box.orca.state();
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'every file and every link is as it was');
  assert.deepEqual(after.inbox, state.inbox, 'every letter is as it was: none read, none rung');
  assert.deepEqual(after.runs, state.runs, 'no Run made, bound or changed');
  assert.deepEqual(after.messages, state.messages, 'no letter sent or acknowledged');
  assert.deepEqual(after.deliveries, state.deliveries, 'no delivery handed over');
  assert.deepEqual(
    after.terminals.map((one) => ({ handle: one.handle, tabId: one.tabId, title: one.title, typed: one.typed })),
    state.terminals.map((one) => ({ handle: one.handle, tabId: one.tabId, title: one.title, typed: one.typed })),
    'no tab opened, closed, retitled or typed into',
  );
  const calls = (await box.orca.calls()).slice(asked);
  assertOrcaCallsAllowed(calls);
  const forbidden = calls.filter((call) => ['orchestration check', 'orchestration run-use', 'orchestration run-create', 'orchestration send', 'terminal send'].includes(orcaCommand(call)));
  assert.deepEqual(forbidden.map((call) => call.args), [], 'health takes no mail, binds no Run, sends nothing and types nothing');
  const reads = orcaCallsOf(calls, 'orchestration inbox');
  assert.ok(reads.some((call) => orcaFlag(call, '--terminal') === `run:${daily}`), `health read daily's mailbox as run:${daily}, got: ${JSON.stringify(reads.map((call) => call.args))}`);
  const books = [await bookIn(bots, 'bot-father'), await bookIn(bots, 'api-bot')];
  const mailboxes = books.flatMap((book) => Object.values(book.sessions ?? {}).map((entry) => `run:${entry.mailbox}`));
  for (const call of reads) {
    assert.ok(mailboxes.includes(orcaFlag(call, '--terminal')), `each read names a mailbox a book names, as run:<id>, got: ${call.args.join(' ')}`);
  }
});
