// Whose conversation a report is about (round 2, finding 2).
//
// The hook finds its session from `ORCA_TAB_ID`, and Orca puts that in the
// environment of everything running in a tab — everything, all the way down. A
// session that runs `codex exec` gives its child the same tab id, the child's
// own hook fires, and the book took the child's conversation for the session's.
// The reviewer did exactly that: one bounded `codex exec` inside a real Codex
// session put the session's own id into the history and `up` afterwards resumed
// the child's conversation instead of the session's.
//
// So the tab id says which session, and something else has to say whether this
// is that session's own harness. That something is the process tree. Measured
// live on both harnesses today:
//
//     the hook            /bin/sh <the hook command>   parent: the harness
//     the harness         claude … / codex …           parent: the tab's shell
//     the tab's shell     the shell the launch line ran in
//
// so the launch line now carries that shell's own pid — `OBK_TAB_SHELL=$$` in
// front of the harness word, filled in by the tab's shell as it reads the line —
// and a report counts only when the harness that invoked the hook is a child of
// it. A harness the session started is a generation further down and is not.
//
// Testing a rule about ancestry needs real ancestry, so these tests build the
// chain rather than describe it: `throughAHarness` in helpers/cli.js stands in
// for the tab's shell and for the harness under it, and can put a second harness
// underneath the first. None of them is the kit; the command they run is the
// kit's own, read out of the bot's own hook file.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  bareLaunch,
  bookOf,
  botHomeOf,
  createSandbox,
  fakeProgram,
  hooksIn,
  kitHooksIn,
  recordSession,
  sessionIn,
  sessionStart,
  sh,
  tabsOfBot,
  TAB_SHELL,
  throughAHarness,
  typedInto,
} from './helpers/cli.js';

/** A bots folder with one bot on `harness`, one session, brought up. */
async function started(box, harness = 'claude', settings = []) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', ...settings]);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']);
  assert.equal(up.code, 0, up.stderr);

  const bots = box.path('bots');
  return { bots, harness, tab: JSON.parse(up.stdout).tabs[0], home: botHomeOf(bots, 'api-bot') };
}

/** The kit's own hook command line, as the bot's hook file holds it. */
async function hookCommandOf(bots, harness) {
  const found = kitHooksIn(await hooksIn(bots, 'api-bot', harness));
  assert.equal(found.length, 1, `one hook command should be installed, got: ${JSON.stringify(found)}`);
  return found[0];
}

/**
 * Report a conversation the way the session's own harness does: the kit's own
 * hook command, out of the bot's own hook file, under the process chain a real
 * harness makes (helpers/cli.js). `nested` puts a second harness underneath the
 * first, which is the case the review found.
 */
async function reportThroughAHarness(box, { bots, harness, tab }, { session, source = 'startup', nested = false }) {
  const ran = await throughAHarness(box, await hookCommandOf(bots, harness), {
    tab: tab.tabId,
    stdin: sessionStart({ session, source }),
    nested,
  });
  assert.equal(ran.code, 0, `the hook must never fail the session: ${ran.stderr}`);
  assert.equal(ran.stderr, '', `and never say anything on the way out: ${ran.stderr}`);
  return ran;
}

test('the launch line hands the tab\'s own shell pid to the harness', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'claude', {});
  const { tab } = await started(box, 'claude');

  const typed = typedInto((await box.orca.terminals()).find((one) => one.tabId === tab.tabId))[0];
  assert.ok(typed.startsWith(`${TAB_SHELL} `), `the pid comes first, got: ${typed}`);
  assert.equal(typed, bareLaunch(box, 'claude', 'api-bot', 'daily'), 'and nothing else about the line changed');

  // `$$` is the shell's own pid, and it is the shell reading the line that
  // fills it in — so what the harness is given is a real live process, not the
  // two characters the kit typed.
  const ran = await sh(`${typed}; :`, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, ran.stderr);
  const calls = await fake.calls();
  assert.equal(calls.length, 1, `the line should start the harness once, got: ${typed}`);
  assert.match(
    calls[0].env.OBK_TAB_SHELL ?? '',
    /^[1-9][0-9]*$/,
    `the harness should be given a pid, got: ${JSON.stringify(calls[0].env.OBK_TAB_SHELL)}`,
  );
});

for (const harness of ['claude', 'codex']) {
  test(`a report from the tab's own ${harness} is the session's, and is recorded`, async (t) => {
    // The ordinary case, through the real chain: the tab's shell, the harness it
    // started, the shell the harness runs the hook in, and the kit.
    const box = await createSandbox(t);
    const bot = await started(box, harness);

    await reportThroughAHarness(box, bot, { session: 'sess-1' });

    assert.equal(
      (await sessionIn(bot.bots, 'api-bot', 'daily')).session,
      'sess-1',
      'the session\'s own harness is believed',
    );
  });

  test(`a report from a ${harness} the session started itself changes nothing`, async (t) => {
    // The review's case. The inner harness inherits `ORCA_TAB_ID` and every
    // other variable, so nothing in its environment tells it apart — only where
    // it sits in the process tree does.
    const box = await createSandbox(t);
    const bot = await started(box, harness);
    await reportThroughAHarness(box, bot, { session: 'sess-1' });
    const before = await readFile(bookOf(bot.bots, 'api-bot'), 'utf8');
    const calls = (await box.orca.calls()).length;

    const said = await reportThroughAHarness(box, bot, { session: 'sess-inner', nested: true });

    assert.equal(said.stdout, '', `a child's report is answered with nothing: ${said.stdout}`);
    assert.equal(
      await readFile(bookOf(bot.bots, 'api-bot'), 'utf8'),
      before,
      'and the book is exactly as it was: the session is still running the conversation it reported',
    );
    assert.equal((await box.orca.calls()).length, calls, 'and nothing was asked of Orca');
  });
}

test('a child\'s report cannot put the session\'s own conversation into history', async (t) => {
  // What the resume afterwards depends on. The reviewer watched the parent's id
  // go into the history and `up` resume the child's conversation; so the whole
  // of the entry has to be untouched, not only its `session`.
  const box = await createSandbox(t);
  const bot = await started(box, 'codex');
  await reportThroughAHarness(box, bot, { session: 'sess-1' });

  await reportThroughAHarness(box, bot, { session: 'sess-inner', nested: true });

  const daily = await sessionIn(bot.bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-1', `got: ${JSON.stringify(daily)}`);
  assert.equal('history' in daily, false, `nothing was replaced, so there is no history: ${JSON.stringify(daily)}`);

  // And the run that follows resumes the session's own conversation.
  const tab = (await tabsOfBot(box, bot.bots, 'api-bot'))[0];
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tab.tabId) });
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);

  const line = typedInto((await tabsOfBot(box, bot.bots, 'api-bot'))[0])[0];
  assert.ok(line.includes('sess-1'), `the session's own conversation is the one resumed, got: ${line}`);
  assert.ok(!line.includes('sess-inner'), `and never the child's, got: ${line}`);
});

test('a child\'s report is not believed even when the session has reported nothing yet', async (t) => {
  // The first id a session ever gets is the one everything after it is compared
  // against, so a child slipping in before the parent has reported is the worst
  // moment for it to be believed.
  const box = await createSandbox(t);
  const bot = await started(box, 'codex');
  const before = await readFile(bookOf(bot.bots, 'api-bot'), 'utf8');

  await reportThroughAHarness(box, bot, { session: 'sess-inner', nested: true });

  assert.equal(await readFile(bookOf(bot.bots, 'api-bot'), 'utf8'), before);
  assert.equal('session' in (await sessionIn(bot.bots, 'api-bot', 'daily')), false);
});

test('a report with no OBK_TAB_SHELL in the environment records nothing', async (t) => {
  // A harness that was already running before the kit began sending the pid has
  // none, and there is no way to tell it from a child. Nothing is written rather
  // than something guessed — which does mean such a session stops being recorded
  // until it is next restarted.
  const box = await createSandbox(t);
  const bot = await started(box, 'claude');
  const before = await readFile(bookOf(bot.bots, 'api-bot'), 'utf8');

  const ran = await recordSession(box, {
    bots: bot.bots, bot: 'api-bot', tab: bot.tab.tabId, session: 'sess-1', raw: true,
  });

  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout, '', `nothing is printed: ${ran.stdout}`);
  assert.equal(ran.stderr, '', `and nothing is said on the way out either: ${ran.stderr}`);
  assert.equal(await readFile(bookOf(bot.bots, 'api-bot'), 'utf8'), before);
});

test('a report naming a shell that is not there records nothing', async (t) => {
  // A pid that answers for nobody — the shell is gone, or the number is from
  // another machine's tab. Ownership cannot be established, so nothing is.
  const box = await createSandbox(t);
  const bot = await started(box, 'claude');
  const before = await readFile(bookOf(bot.bots, 'api-bot'), 'utf8');

  const ran = await recordSession(box, {
    bots: bot.bots, bot: 'api-bot', tab: bot.tab.tabId, session: 'sess-1', raw: true,
    // A pid no process can have, so nothing is being accused of owning it.
    env: { ...box.env, OBK_TAB_SHELL: '2147483647' },
  });

  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout, '');
  assert.equal(await readFile(bookOf(bot.bots, 'api-bot'), 'utf8'), before);
});

test('an OBK_TAB_SHELL that is not a pid at all records nothing', async (t) => {
  const box = await createSandbox(t);
  const bot = await started(box, 'claude');
  const before = await readFile(bookOf(bot.bots, 'api-bot'), 'utf8');

  for (const value of ['', 'mine', '0', '-1', '12; rm -rf /']) {
    const ran = await recordSession(box, {
      bots: bot.bots, bot: 'api-bot', tab: bot.tab.tabId, session: 'sess-1', raw: true,
      env: { ...box.env, OBK_TAB_SHELL: value },
    });
    assert.equal(ran.code, 0, `${JSON.stringify(value)}: ${ran.stderr}`);
    assert.equal(ran.stdout, '', `${JSON.stringify(value)}: ${ran.stdout}`);
  }
  assert.equal(await readFile(bookOf(bot.bots, 'api-bot'), 'utf8'), before);
});

test('the tab\'s own harness is still believed after a clear, and is handed its duty', async (t) => {
  // Ownership and the clear rule together: the session's own harness reporting a
  // conversation that is not the one the book held is a clear, and gets the duty
  // back. A child reporting the same thing gets nothing and changes nothing.
  const box = await createSandbox(t);
  const prompt = 'Read your AGENTS.md and keep the queue moving.';
  const bot = await started(box, 'claude', ['--prompt', prompt]);
  await reportThroughAHarness(box, bot, { session: 'sess-1' });

  const cleared = await reportThroughAHarness(box, bot, { session: 'sess-2', source: 'clear' });

  assert.equal(JSON.parse(cleared.stdout).hookSpecificOutput.additionalContext, prompt);
  const daily = await sessionIn(bot.bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-2');
  assert.deepEqual(daily.history.map((old) => old.session), ['sess-1']);
});
