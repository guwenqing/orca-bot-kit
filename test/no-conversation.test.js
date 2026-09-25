// A book id with no conversation behind it (#295).
//
// `obk unpause`, `obk up` and `obk restart` bring a session back as it was: when
// the book names a conversation, the launch line resumes it. But the book can
// name one the harness never wrote down. A harness reports its id through the
// kit's hook as it starts, before anything has been said to it, and Claude Code
// writes its transcript only once the conversation has had a turn. A session
// paused before its first turn therefore came back with `--resume <id>`, and
// Claude Code answered "No conversation found": no duty, no session.
//
// So before a new tab resumes the id the book holds, the kit asks the harness
// whether it has that conversation on record, where the harness keeps it (tech
// notes, sections 2 and 3):
//
//   Claude Code  ~/.claude/projects/<slug>/<id>.jsonl, <slug> being the bot
//                home's real path with everything but a letter or a digit
//                turned into a dash: one folder per working directory
//   Codex        ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<stamp>-<id>.jsonl,
//                under whatever day the conversation began
//
// On record, nothing changes: the tab resumes it. Not on record, the session
// starts fresh with its duty, exactly as a session the book holds no id for;
// the id leaves `session` for the session's `history`, as
// `{ session: <id>, ended: 'no conversation', at: <when> }`; the tab's report
// says `resumed: false` and `noConversation: <id>`, and the plain report says
// the conversation had nothing on record. When the fresh session's hook then
// reports its own id, the book takes it and the hook does not hand the duty
// over a second time: the launch line carried it.
//
// HOME is inside every sandbox, so the harness's records are files the tests
// plant there (helpers/cli.js `conversationOnRecord`), or leave out.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bareLaunch,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  harnessChain,
  orcaCallsOf,
  recordSession,
  sessionIn,
  sessionStart,
  shellWord,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

const BOT = 'api-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** Conversation ids shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/**
 * A bots folder with api-bot on `harness` and the sessions named, each with
 * its own start prompt, brought up once. Every session's tab is reported.
 */
async function started(box, harness, sessions = ['daily']) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness])).code, 0);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, '--prompt', promptOf(name)]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT, '--json']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  return {
    bots,
    home: botHomeOf(bots, BOT),
    tabs: Object.fromEntries(JSON.parse(up.stdout).tabs.map((entry) => [entry.name, entry])),
  };
}

/** Each session's duty: daily's is PROMPT, and any other's names the session. */
const promptOf = (name) => (name === 'daily' ? PROMPT : `${PROMPT} You are ${name}.`);

/** The hook's report of the conversation a session's tab is running, as the harness makes it. */
const reported = (box, bots, tab, id, source = 'startup') =>
  recordSession(box, { bots, bot: BOT, tab, session: id, source });

/** The session's tab, closed the way a user closes one: Orca simply stops listing it. */
async function closeTab(box, tabId) {
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId) });
}

/** Run `obk <command> --bots bots --bot api-bot [...more]`, which must succeed. */
async function ran(box, command, more = []) {
  const result = await box.run([command, '--bots', 'bots', '--bot', BOT, ...more]);
  assert.equal(result.code, 0, `obk ${command} should succeed: ${result.stderr}${result.stdout}`);
  return result;
}

/** The new tab a run's --json reports for `name`. */
function newTabOf(result, name = 'daily') {
  const found = JSON.parse(result.stdout).tabs.filter((entry) => entry.name === name && entry.created === true);
  assert.equal(found.length, 1, `the run should report ${name}'s new tab once, got: ${result.stdout}`);
  return found[0];
}

/** What was typed into the tab the book now gives `name`: the one line that started it. */
async function lineOf(box, bots, name = 'daily') {
  const entry = await sessionIn(bots, BOT, name);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry?.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry?.tab}`);
  const typed = typedInto(terminal);
  assert.equal(typed.length, 1, `one line per tab the kit opens, got: ${JSON.stringify(typed)}`);
  return typed[0];
}

/** The line a session starts fresh on: its settings, then its duty. */
const freshLine = (box, harness, name = 'daily') => `${bareLaunch(box, harness, BOT, name)} -- '${promptOf(name)}'`;

/** The line a session resumes `id` on: Claude Code by the flag, Codex by the subcommand. */
const resumeLine = (box, harness, id, name = 'daily') => (harness === 'claude'
  ? `${bareLaunch(box, 'claude', BOT, name)} --resume ${id}`
  : bareLaunch(box, 'codex', BOT, name).replace(/ codex /, ' codex resume ') + ` ${id}`);

/**
 * The book's history for `name` ends with `id`, gone for having no
 * conversation, stamped within the run, after the `before` entries it already
 * held (compared without their own times).
 */
async function assertMovedToHistory(bots, id, { from, to, before = [], name = 'daily' }) {
  const entry = await sessionIn(bots, BOT, name);
  assert.notEqual(entry?.session, id, `the book should no longer hold ${id} as the session's, got: ${JSON.stringify(entry)}`);
  const history = entry?.history;
  assert.ok(Array.isArray(history), `the id should have gone into the session's history, got: ${JSON.stringify(entry)}`);
  assert.deepEqual(
    history.map(({ session, ended }) => ({ session, ended })),
    [...before, { session: id, ended: 'no conversation' }],
    `the history keeps what it had and ends with the id that had nothing behind it, got: ${JSON.stringify(history)}`,
  );
  const at = String(history.at(-1).at);
  assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, `the time should be ISO 8601, got: ${at}`);
  const stamp = Date.parse(at);
  assert.ok(stamp >= from - 1000 && stamp <= to + 1000, `and it should be the time of the run, got: ${at}`);
}

/** The tab's --json entry says it started fresh because `id` had nothing behind it. */
function assertReportedFresh(entry, id) {
  assert.equal(entry.resumed, false, `nothing was resumed, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.noConversation, id, `and the entry names the id that had no conversation, got: ${JSON.stringify(entry)}`);
}

/** The plain report says, of the id, that there was nothing on record behind it. */
function assertSaysNothingOnRecord(result, id) {
  assert.ok(result.stdout.includes(id), `the report should name the book's conversation ${id}, got:\n${result.stdout}`);
  assert.match(result.stdout, /nothing on record/, `and say there was nothing on record behind it, got:\n${result.stdout}`);
}

// ------------------------------------------------ paused before its first turn

for (const harness of ['claude', 'codex']) {
  // Covers the issue as seen: the hook reported an id as the harness started,
  // the session was paused before anything was said to it, and the harness
  // has nothing on record for that id. It comes back with its duty, on a fresh
  // conversation, and the book says what became of the id.
  test(`N1 on ${harness}, unpause of a session paused before its first turn starts it fresh with its duty`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tabs } = await started(box, harness);
    await reported(box, bots, tabs.daily.tabId, conv(1));
    await ran(box, 'pause');

    const from = Date.now();
    const result = await ran(box, 'unpause', ['--json']);
    const to = Date.now();

    const line = await lineOf(box, bots);
    assert.equal(line, freshLine(box, harness), 'a fresh start, told its duty, exactly as a session the book holds no id for');
    assert.ok(!line.includes(conv(1)), `the id with nothing behind it is nowhere on the line, got: ${line}`);
    await assertMovedToHistory(bots, conv(1), { from, to });
    assertReportedFresh(newTabOf(result), conv(1));
  });

  // Covers the plain report of the same run.
  test(`N2 on ${harness}, the plain report of that unpause says the book's conversation had nothing on record`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tabs } = await started(box, harness);
    await reported(box, bots, tabs.daily.tabId, conv(1));
    await ran(box, 'pause');

    const result = await ran(box, 'unpause');

    assertSaysNothingOnRecord(result, conv(1));
  });

  // Covers: the rest of the book's entry is kept as on any fresh start. The
  // mailbox and the address are the session's whatever conversation it has.
  test(`N3 on ${harness}, the rest of the session's entry is kept when its id goes into history`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tabs } = await started(box, harness);
    await reported(box, bots, tabs.daily.tabId, conv(1));
    await ran(box, 'pause');
    const before = await sessionIn(bots, BOT, 'daily');
    assert.equal(typeof before.mailbox, 'string', `the session had a mailbox to keep, got: ${JSON.stringify(before)}`);

    const result = await ran(box, 'unpause', ['--json']);

    const after = await sessionIn(bots, BOT, 'daily');
    assert.equal(after.tab, newTabOf(result).tabId, 'the book follows the session to its new tab');
    assert.equal(after.mailbox, before.mailbox, 'the mailbox is the session\'s, and stays');
    assert.equal(after.address, before.address, 'and so is its address');
    assert.notEqual(after.session, conv(1), `the id with nothing behind it is not the session's any more, got: ${JSON.stringify(after)}`);
  });
}

// ------------------------------------------------ the same through up and restart

for (const harness of ['claude', 'codex']) {
  // Covers: `up` after the tab was closed, by the user or a reboot.
  test(`N4 on ${harness}, up after the tab was closed starts a session with no conversation fresh`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tabs } = await started(box, harness);
    await reported(box, bots, tabs.daily.tabId, conv(1));
    await closeTab(box, tabs.daily.tabId);

    const from = Date.now();
    const result = await ran(box, 'up', ['--json']);
    const to = Date.now();

    const line = await lineOf(box, bots);
    assert.equal(line, freshLine(box, harness));
    assert.ok(!line.includes(conv(1)), `got: ${line}`);
    await assertMovedToHistory(bots, conv(1), { from, to });
    assertReportedFresh(newTabOf(result), conv(1));
  });

  // Covers: `restart` of a live tab whose book id has nothing behind it. The
  // tab is closed as for any restart; the one it opens starts fresh.
  test(`N5 on ${harness}, restart of a live tab whose id has no conversation opens a fresh one`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tabs } = await started(box, harness);
    await reported(box, bots, tabs.daily.tabId, conv(1));

    const from = Date.now();
    const result = await ran(box, 'restart', ['--json']);
    const to = Date.now();

    const entry = newTabOf(result);
    assert.notEqual(entry.tabId, tabs.daily.tabId, 'a restart opens a new tab');
    const line = await lineOf(box, bots);
    assert.equal(line, freshLine(box, harness));
    assert.ok(!line.includes(conv(1)), `got: ${line}`);
    await assertMovedToHistory(bots, conv(1), { from, to });
    assertReportedFresh(entry, conv(1));
  });
}

test('N6 the plain reports of up and restart say the book\'s conversation had nothing on record', async (t) => {
  for (const command of ['up', 'restart']) {
    const box = await createSandbox(t);
    const { bots, tabs } = await started(box, 'claude');
    await reported(box, bots, tabs.daily.tabId, conv(1));
    if (command === 'up') await closeTab(box, tabs.daily.tabId);

    const result = await ran(box, command);

    assertSaysNothingOnRecord(result, conv(1));
  }
});

test('N7 an id that goes into history goes after the history the session already had', async (t) => {
  // Covers: "after any history already there". The session cleared once, and
  // the conversation it cleared into had no turn before its tab closed.
  const box = await createSandbox(t);
  const { bots, home, tabs } = await started(box, 'claude');
  await reported(box, bots, tabs.daily.tabId, conv(1));
  await conversationOnRecord(box, { harness: 'claude', cwd: home, id: conv(1) });
  await reported(box, bots, tabs.daily.tabId, conv(2), 'clear');
  await closeTab(box, tabs.daily.tabId);

  const from = Date.now();
  const result = await ran(box, 'up', ['--json']);
  const to = Date.now();

  await assertMovedToHistory(bots, conv(2), { from, to, before: [{ session: conv(1), ended: 'clear' }] });
  assertReportedFresh(newTabOf(result), conv(2));
});

// ------------------------------------------------ the session's own id arrives

for (const harness of ['claude', 'codex']) {
  // Covers: the fresh session's hook reports its new id. The book takes it, the
  // id with nothing behind it stays in history, and the hook does not hand the
  // duty over again, because the fresh launch line already carried it. A clear
  // after that still gets the duty from the hook, which shows the hook was
  // listening all along.
  test(`N8 on ${harness}, the fresh session's own id is taken without its duty being handed over twice`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tabs } = await started(box, harness);
    await reported(box, bots, tabs.daily.tabId, conv(1));
    await closeTab(box, tabs.daily.tabId);
    const from = Date.now();
    const back = newTabOf(await ran(box, 'up', ['--json']));
    const to = Date.now();

    const first = await reported(box, bots, back.tabId, conv(2));

    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stdout, '', `the launch line gave the session its duty, so the hook hands it nothing, got: ${first.stdout}`);
    const entry = await sessionIn(bots, BOT, 'daily');
    assert.equal(entry.session, conv(2), `the book takes the session's own id, got: ${JSON.stringify(entry)}`);
    await assertMovedToHistory(bots, conv(1), { from, to });

    const cleared = await reported(box, bots, back.tabId, conv(3), 'clear');
    assert.equal(cleared.code, 0, cleared.stderr);
    assert.ok(cleared.stdout.includes(PROMPT), `after a clear the hook does hand the duty over, got: ${cleared.stdout}`);
  });
}

// ------------------------------------------------ a conversation on record (out of scope: unchanged)

for (const harness of ['claude', 'codex']) {
  // Covers the boundary: a conversation that does exist is resumed, as before.
  test(`N9 on ${harness}, unpause of a session whose conversation is on record resumes it`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home, tabs } = await started(box, harness);
    await reported(box, bots, tabs.daily.tabId, conv(1));
    await conversationOnRecord(box, { harness, cwd: home, id: conv(1) });
    await ran(box, 'pause');

    const result = await ran(box, 'unpause', ['--json']);

    assert.equal(await lineOf(box, bots), resumeLine(box, harness, conv(1)), 'the conversation it had, and no duty again');
    const entry = await sessionIn(bots, BOT, 'daily');
    assert.equal(entry.session, conv(1), 'the book still holds it');
    assert.equal('history' in entry, false, `nothing went into history, got: ${JSON.stringify(entry)}`);
    const tab = newTabOf(result);
    assert.equal(tab.resumed, true);
    assert.equal('noConversation' in tab, false, `a conversation that is there is not reported missing, got: ${JSON.stringify(tab)}`);
  });

  test(`N10 on ${harness}, up and restart resume a conversation that is on record`, async (t) => {
    for (const command of ['up', 'restart']) {
      const box = await createSandbox(t);
      const { bots, home, tabs } = await started(box, harness);
      await reported(box, bots, tabs.daily.tabId, conv(1));
      await conversationOnRecord(box, { harness, cwd: home, id: conv(1) });
      if (command === 'up') await closeTab(box, tabs.daily.tabId);

      const result = await ran(box, command, ['--json']);

      assert.equal(await lineOf(box, bots), resumeLine(box, harness, conv(1)), `${command} resumes it`);
      assert.equal((await sessionIn(bots, BOT, 'daily')).session, conv(1));
      const tab = newTabOf(result);
      assert.equal(tab.resumed, true, `${command}: ${JSON.stringify(tab)}`);
      assert.equal('noConversation' in tab, false, `${command}: ${JSON.stringify(tab)}`);
    }
  });
}

test('N11 a Codex conversation filed under another day than today is on record, and is resumed', async (t) => {
  // Codex files a rollout under the day the conversation began, which for a
  // session brought back after a pause is rarely today.
  const box = await createSandbox(t);
  const { bots, home, tabs } = await started(box, 'codex');
  await reported(box, bots, tabs.daily.tabId, conv(1));
  const file = await conversationOnRecord(box, { harness: 'codex', cwd: home, id: conv(1), at: new Date('2025-11-03T08:15:42.000Z') });
  assert.ok(file.includes('/2025/11/03/'), `the record is filed under its own day, got: ${file}`);
  await closeTab(box, tabs.daily.tabId);

  const result = await ran(box, 'up', ['--json']);

  assert.equal(await lineOf(box, bots), resumeLine(box, 'codex', conv(1)));
  assert.equal(newTabOf(result).resumed, true);
});

// ------------------------------------------------ records that are not this one

test('N12 a Claude record of the id in another bot home\'s folder does not count for this bot', async (t) => {
  // Claude Code keeps one folder per working directory, and a session's is its
  // bot home. The same id under another folder is not this session's record.
  const box = await createSandbox(t);
  const { bots, tabs } = await started(box, 'claude');
  await reported(box, bots, tabs.daily.tabId, conv(1));
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, 'bot-father'), id: conv(1) });
  await ran(box, 'pause');

  const result = await ran(box, 'unpause', ['--json']);

  assert.equal(await lineOf(box, bots), freshLine(box, 'claude'));
  assertReportedFresh(newTabOf(result), conv(1));
});

for (const harness of ['claude', 'codex']) {
  test(`N13 on ${harness}, another conversation on record in the bot home is not the book's id on record`, async (t) => {
    // The harness has something in this bot's folder, just not the id the book
    // holds: a record is looked for by its id, not by the folder having one.
    const box = await createSandbox(t);
    const { bots, home, tabs } = await started(box, harness);
    await reported(box, bots, tabs.daily.tabId, conv(1));
    await conversationOnRecord(box, { harness, cwd: home, id: conv(9) });
    await closeTab(box, tabs.daily.tabId);

    const result = await ran(box, 'up', ['--json']);

    const line = await lineOf(box, bots);
    assert.equal(line, freshLine(box, harness), 'a fresh start with its duty');
    assert.ok(!line.includes(conv(1)), `got: ${line}`);
    assertReportedFresh(newTabOf(result), conv(1));
  });
}

test('N14 in one run, each session is judged by its own record', async (t) => {
  // daily's conversation is on record and review's is not: daily resumes and
  // review starts fresh with its own duty, neither taking the other's answer.
  const box = await createSandbox(t);
  const { bots, home, tabs } = await started(box, 'claude', ['daily', 'review']);
  await reported(box, bots, tabs.daily.tabId, conv(1));
  await reported(box, bots, tabs.review.tabId, conv(2));
  await conversationOnRecord(box, { harness: 'claude', cwd: home, id: conv(1) });
  await box.orca.set({ terminals: [] });

  const result = await ran(box, 'up', ['--json']);

  assert.equal(await lineOf(box, bots, 'daily'), resumeLine(box, 'claude', conv(1), 'daily'));
  assert.equal(await lineOf(box, bots, 'review'), freshLine(box, 'claude', 'review'));
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, conv(1), 'daily keeps its conversation');
  assert.notEqual((await sessionIn(bots, BOT, 'review')).session, conv(2), 'review\'s id had nothing behind it');
  assert.equal(newTabOf(result, 'daily').resumed, true);
  assertReportedFresh(newTabOf(result, 'review'), conv(2));
});

// ------------------------------------------------ a report while the tab is being opened

/**
 * Arrange for the kit's hook to report `id` for the session in `tab` while the
 * next run is inside Orca's `terminal create`: a harness still running in the
 * old tab, starting a new conversation while `up` opens the new one. Run under
 * the process chain the kit reads ownership from (helpers/cli.js `harnessChain`).
 */
async function aReportDuringCreate(box, bots, tab, id) {
  const hook = [box.cli, 'session', 'record', '--bots', bots, '--bot', BOT].map(shellWord).join(' ');
  const chain = await harnessChain(box, hook, { stdin: sessionStart({ session: id }) });
  await box.orca.set({
    runDuring: {
      command: 'terminal create',
      argv: chain.argv,
      env: { ...chain.env, ORCA_TAB_ID: tab },
      on: orcaCallsOf(await box.orca.calls(), 'terminal create').length + 1,
    },
  });
}

for (const harness of ['claude', 'codex']) {
  // Covers the race in the review of PR #310: the book holds A with nothing on
  // record, so `up` decides on a fresh start; while it opens the new tab, the
  // old tab's hook reports B. The new tab's launch line carries the duty, so
  // the session is told it once: when its own hook reports C, the hook hands
  // nothing over. The book ends on C, with A and B both kept in history and B
  // replaced by the fresh start; the tab's report still names A.
  test(`N15 on ${harness}, an id reported while up opens the fresh tab does not get the duty handed over twice`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tabs } = await started(box, harness);
    await reported(box, bots, tabs.daily.tabId, conv(1));
    await closeTab(box, tabs.daily.tabId);
    await aReportDuringCreate(box, bots, tabs.daily.tabId, conv(2));

    const back = newTabOf(await ran(box, 'up', ['--json']));

    const during = await box.orca.ranDuring();
    assert.equal(during.length, 1, `the old tab's hook should have reported in the middle of the run, got: ${JSON.stringify(during)}`);
    assert.equal(during[0].status, 0, `and not failed: ${during[0].stderr}`);
    assert.equal(await lineOf(box, bots), freshLine(box, harness), 'the premise: the new tab was started fresh, with its duty');
    assertReportedFresh(back, conv(1));

    const own = await reported(box, bots, back.tabId, conv(3));

    assert.equal(own.code, 0, own.stderr);
    assert.equal(own.stdout, '', `the launch line gave the session its duty, so the hook hands it nothing, got: ${own.stdout}`);
    const entry = await sessionIn(bots, BOT, 'daily');
    assert.equal(entry.session, conv(3), `the book takes the new tab's own id, got: ${JSON.stringify(entry)}`);
    const history = Array.isArray(entry.history) ? entry.history : [];
    assert.ok(history.some((old) => old?.session === conv(1)), `A stays in history, got: ${JSON.stringify(entry)}`);
    assert.deepEqual(
      history.filter((old) => old?.session === conv(2)).map(({ session, ended }) => ({ session, ended })),
      [{ session: conv(2), ended: 'replaced' }],
      `B is in history once, replaced by the fresh start, got: ${JSON.stringify(entry)}`,
    );

    const cleared = await reported(box, bots, back.tabId, conv(4), 'clear');
    assert.equal(cleared.code, 0, cleared.stderr);
    assert.ok(cleared.stdout.includes(PROMPT), `after a clear the hook does hand the duty over, got: ${cleared.stdout}`);
  });
}
