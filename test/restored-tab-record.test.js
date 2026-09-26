// A session Orca brought back by itself is still the kit's session (#318).
//
// After a machine restart or an Orca update, Orca resumes every tab's harness
// on its own, as a bare `claude --resume <id>` or `codex resume <id>`. Nothing
// of the kit's launch line is in that harness's environment: no OBK_TAB_SHELL,
// no OBK_CLI. Until #318 a report counted only when OBK_TAB_SHELL named the
// harness's parent, so in such a tab a `/clear` was never written to the book,
// the cleared session was never told its duty again, and a later `up` or
// `restart` would have resumed the conversation it had left.
//
// What tells the tab's own harness apart without the marker is where it sits.
// Measured live on Orca 1.4.210, for restored and kit-launched harnesses alike
// (tech notes, section 1):
//
//     the pane         /usr/bin/login
//     the tab's shell  -/bin/zsh          parent: the pane
//     the harness      claude / codex     parent: the tab's shell
//     the hook         /bin/sh -c <hook>  parent: the harness, or the hook
//                                         itself when the shell execs it
//
// So with no OBK_TAB_SHELL in the environment a report counts when the harness
// that ran the hook is a child of a shell that is a child of `login`, and then
// the book's usual rules apply: a first report is written, a new id moves the
// old one into history and hands the duty back, and the book's own id come back
// changes nothing. A harness the session started itself is a generation
// further down, a stranger's harness in another tab reports a tab the book does
// not name, and a hook with no `login` two levels above its harness has no tab
// behind it: none of them is written, marker or not. With OBK_TAB_SHELL in the
// environment the marker's rule decides, as before (test/session-ownership.test.js).
//
// Testing a rule about ancestry needs real ancestry, read by the machine's own
// `ps`: `throughATab` in helpers/cli.js builds the chain above out of real
// processes named as the real ones are, and the command it runs is the kit's
// own, read out of the bot's own hook file. Every test that says a report is
// not written also shows, in the same sandbox, the tab's own harness being
// written, so that the refusal cannot pass because nothing works at all.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  bookOf,
  createSandbox,
  hooksIn,
  kitHooksIn,
  sessionIn,
  sessionStart,
  throughAHarness,
  throughATab,
} from './helpers/cli.js';

/** What the sessions here are told to do, and are told again after a clear. */
const DUTY = 'Read your AGENTS.md and keep the queue moving.';

/** A bots folder with one bot on `harness`, one session with a duty, brought up by the kit. */
async function started(box, harness) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--prompt', DUTY]);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']);
  assert.equal(up.code, 0, up.stderr);

  return { bots: box.path('bots'), harness, tab: JSON.parse(up.stdout).tabs[0].tabId };
}

/** The kit's own hook command line, as the bot's hook file holds it. */
async function hookCommandOf(bots, harness) {
  const found = kitHooksIn(await hooksIn(bots, 'api-bot', harness));
  assert.equal(found.length, 1, `one hook command should be installed, got: ${JSON.stringify(found)}`);
  return found[0];
}

/**
 * Report a conversation from the tab the way a harness Orca resumed by itself
 * does: the kit's own hook, under the tab's real ancestry, with none of the
 * launch line's variables. `shape`, `direct`, `tab` and `env` bend it as
 * `throughATab` says.
 */
async function fromTheTab(box, bot, { session, source = 'startup', shape = 'tab', direct = false, tab = bot.tab, env } = {}) {
  const ran = await throughATab(box, await hookCommandOf(bot.bots, bot.harness), {
    tab,
    stdin: sessionStart({ session, source }),
    harness: bot.harness,
    shape,
    direct,
    env,
  });
  assert.equal(ran.code, 0, `the hook must never fail the session: ${ran.stderr}`);
  assert.equal(ran.stderr, '', `and never say anything on the way out: ${ran.stderr}`);
  return ran;
}

/**
 * What the kit's own launch line left in the book before the restart: the
 * session's first conversation, reported by its harness with the marker.
 */
async function recordedBeforeTheRestart(box, bot, session) {
  const ran = await throughAHarness(box, await hookCommandOf(bot.bots, bot.harness), {
    tab: bot.tab,
    stdin: sessionStart({ session, source: 'startup' }),
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal((await sessionIn(bot.bots, 'api-bot', 'daily')).session, session, 'the premise: the kit\'s own tab was recorded');
}

/** The book, byte for byte. */
const bookText = (bot) => readFile(bookOf(bot.bots, 'api-bot'), 'utf8');

/** The duty the hook handed back, from the answer the harness reads; undefined when it printed nothing. */
function dutyIn(ran) {
  if (ran.stdout === '') return undefined;
  let answer;
  try {
    answer = JSON.parse(ran.stdout);
  } catch (error) {
    return assert.fail(`the hook's answer must be the JSON the harness reads, got: ${ran.stdout} (${error.message})`);
  }
  assert.equal(answer.hookSpecificOutput?.hookEventName, 'SessionStart', `the answer is about the event it was sent, got: ${ran.stdout}`);
  return answer.hookSpecificOutput.additionalContext;
}

/**
 * The positive half every refusal here is set beside: in the same sandbox, the
 * tab's own harness, Orca-restored, clearing to `sess-own`, is written to the
 * book. A refusal that held because nothing is ever written would fail here.
 */
async function assertTheTabsOwnStillCounts(box, bot) {
  await fromTheTab(box, bot, { session: 'sess-own', source: 'clear' });
  assert.equal(
    (await sessionIn(bot.bots, 'api-bot', 'daily')).session,
    'sess-own',
    'the tab\'s own harness, with no marker, is believed in the same sandbox',
  );
}

// ---------------------------------------------------------------------------
// The tab's own harness, with no marker, is believed.
// ---------------------------------------------------------------------------

for (const harness of ['claude', 'codex']) {
  test(`a restored ${harness} tab's own harness is believed: its first report is written into the book`, async (t) => {
    const box = await createSandbox(t);
    const bot = await started(box, harness);

    await fromTheTab(box, bot, { session: 'sess-1', source: 'startup' });

    const daily = await sessionIn(bot.bots, 'api-bot', 'daily');
    assert.equal(daily.session, 'sess-1', `the report from the tab's own harness is the session's, got: ${JSON.stringify(daily)}`);
    assert.equal(daily.tab, bot.tab, 'and the tab is still the key');
    assert.equal('history' in daily, false, 'there was no id before it, so there is nothing to keep');
  });
}

test('a /clear in a Claude tab Orca restored is written to the book, and the session is handed its duty again', async (t) => {
  // The issue's own case, in order: the kit launched the session and learned
  // its conversation; the machine restarted and Orca resumed that conversation
  // by itself; then the user cleared it.
  const box = await createSandbox(t);
  const bot = await started(box, 'claude');
  await recordedBeforeTheRestart(box, bot, 'sess-1');
  await fromTheTab(box, bot, { session: 'sess-1', source: 'resume' });
  const calls = (await box.orca.calls()).length;

  const cleared = await fromTheTab(box, bot, { session: 'sess-2', source: 'clear' });

  assert.equal(dutyIn(cleared), DUTY, 'the cleared session is told its duty again');
  const daily = await sessionIn(bot.bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-2', `the book names the conversation the session is in now, got: ${JSON.stringify(daily)}`);
  assert.deepEqual(
    daily.history.map((old) => [old.session, old.ended]),
    [['sess-1', 'clear']],
    'and the one it left is in its history, ended by the clear',
  );
  assert.equal((await box.orca.calls()).length, calls, 'the hook has no business with Orca');
});

test('a /new in a Codex tab Orca restored is written to the book, and the session is handed its duty again', async (t) => {
  // Codex has no /clear. Its /new fires nothing until the first prompt of the
  // new conversation, which arrives as an ordinary start with a new id (tech
  // notes, section 3).
  const box = await createSandbox(t);
  const bot = await started(box, 'codex');
  await recordedBeforeTheRestart(box, bot, 'sess-1');
  await fromTheTab(box, bot, { session: 'sess-1', source: 'resume' });

  const renewed = await fromTheTab(box, bot, { session: 'sess-2', source: 'startup' });

  assert.equal(dutyIn(renewed), DUTY, 'the new conversation is told its duty again');
  const daily = await sessionIn(bot.bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-2', `got: ${JSON.stringify(daily)}`);
  assert.deepEqual(daily.history.map((old) => [old.session, old.ended]), [['sess-1', 'startup']]);
});

test('a restored tab\'s harness that runs the hook with no shell between them is believed too', async (t) => {
  // Measured live: the hook runs directly under the harness, or through
  // `/bin/sh -c`. Here the shell replaces itself with the hook.
  const box = await createSandbox(t);
  const bot = await started(box, 'claude');
  await recordedBeforeTheRestart(box, bot, 'sess-1');

  const cleared = await fromTheTab(box, bot, { session: 'sess-2', source: 'clear', direct: true });

  assert.equal(dutyIn(cleared), DUTY, 'the cleared session is told its duty again');
  assert.equal((await sessionIn(bot.bots, 'api-bot', 'daily')).session, 'sess-2', 'and the book names its new conversation');
});

for (const harness of ['claude', 'codex']) {
  test(`a restored ${harness} tab resuming the book's own conversation changes nothing and is told nothing`, async (t) => {
    // What Orca's cold restore itself reports: the conversation the book already
    // names, come back. It never lost its duty, so it is not handed it again.
    const box = await createSandbox(t);
    const bot = await started(box, harness);
    await recordedBeforeTheRestart(box, bot, 'sess-1');
    const before = await bookText(bot);

    const resumed = await fromTheTab(box, bot, { session: 'sess-1', source: 'resume' });

    assert.equal(resumed.stdout, '', `a resume is told nothing, got: ${resumed.stdout}`);
    assert.equal(await bookText(bot), before, 'and the book is exactly as it was');

    await assertTheTabsOwnStillCounts(box, bot);
  });
}

// ---------------------------------------------------------------------------
// What is still not the session's own, marker or not.
// ---------------------------------------------------------------------------

for (const harness of ['claude', 'codex']) {
  test(`a harness a restored ${harness} session started itself changes nothing`, async (t) => {
    // The review's case from round 2, in a tab with no marker: the inner
    // harness inherits ORCA_TAB_ID and everything else, and sits one
    // generation further from the tab's shell than the session's own.
    const box = await createSandbox(t);
    const bot = await started(box, harness);
    await recordedBeforeTheRestart(box, bot, 'sess-1');
    const before = await bookText(bot);

    const inner = await fromTheTab(box, bot, { session: 'sess-inner', source: 'startup', shape: 'nested' });

    assert.equal(inner.stdout, '', `a child's report is answered with nothing, got: ${inner.stdout}`);
    assert.equal(await bookText(bot), before, 'and the book still names the session\'s own conversation, with no history');

    await assertTheTabsOwnStillCounts(box, bot);
  });
}

test('a stranger\'s harness in another tab is not recorded, though it sits in a tab\'s own place', async (t) => {
  // A tab of the user's own in the same Orca project, running a harness in the
  // bot's folder: the same hook fires, from a harness that sits exactly where a
  // tab's own does, in a tab the book does not name.
  const box = await createSandbox(t);
  const bot = await started(box, 'claude');
  await recordedBeforeTheRestart(box, bot, 'sess-1');
  const before = await bookText(bot);

  const stranger = await fromTheTab(box, bot, { session: 'sess-stranger', source: 'clear', tab: 'tab_theirs' });

  assert.equal(stranger.stdout, '', `a stranger is told nothing, got: ${stranger.stdout}`);
  assert.equal(await bookText(bot), before, 'and the book is exactly as it was');

  await assertTheTabsOwnStillCounts(box, bot);
});

for (const [shape, why] of [
  ['no-login', 'the shell has no login above it: a shell run from somewhere that is not a tab\'s pane'],
  ['no-shell', 'the harness sits straight under login, with no tab\'s shell between them'],
]) {
  test(`a report whose harness has no login two levels above it is not recorded (${shape}: ${why})`, async (t) => {
    const box = await createSandbox(t);
    const bot = await started(box, 'claude');
    await recordedBeforeTheRestart(box, bot, 'sess-1');
    const before = await bookText(bot);

    const ran = await fromTheTab(box, bot, { session: 'sess-elsewhere', source: 'clear', shape });

    assert.equal(ran.stdout, '', `nothing is handed back, got: ${ran.stdout}`);
    assert.equal(await bookText(bot), before, 'and the book is exactly as it was');

    await assertTheTabsOwnStillCounts(box, bot);
  });
}

test('with OBK_TAB_SHELL in the environment the marker decides, even where a tab\'s ancestry would be believed', async (t) => {
  // #318 leaves the marker's rule as it was: when OBK_TAB_SHELL is there, a
  // report counts only when it names the harness's parent. This one names a
  // pid no process can have, under a chain that without it is believed.
  const box = await createSandbox(t);
  const bot = await started(box, 'claude');
  await recordedBeforeTheRestart(box, bot, 'sess-1');
  const before = await bookText(bot);

  const ran = await fromTheTab(box, bot, {
    session: 'sess-marked', source: 'clear', env: { ...box.env, OBK_TAB_SHELL: '2147483647' },
  });

  assert.equal(ran.stdout, '', `nothing is handed back, got: ${ran.stdout}`);
  assert.equal(await bookText(bot), before, 'and the book is exactly as it was');

  await assertTheTabsOwnStillCounts(box, bot);
});
