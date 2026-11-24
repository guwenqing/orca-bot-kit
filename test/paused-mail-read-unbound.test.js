// Reading the mail of a session with no live tab, on an Orca that unbinds a
// Run when its coordinator terminal closes (issue #858).
//
// A session's mailbox is an Orca Run, bound to one coordinator terminal
// (`coordinator_handle` in `run-show --full`). Up to Orca 1.4.271, closing a
// tab leaves the closed handle on the Run, and `obk message check` from a
// plain shell reads a paused session's mail as that handle (#249; the default
// fake, tested in paused-mail-read.test.js).
//
// Orca 1.4.272 changed that. Read in Orca's source at tag v1.4.272 (commit
// 910fe80ce8a, stablyai/orca#47135), and seen live on 2026-11-24 on 1.4.272:
// when a terminal ends with nothing left in its pane, or a tab or pane is
// closed, Orca unbinds every Run that terminal coordinated: `coordinator_handle`
// becomes null and `consumer_generation` goes up by one. Seen live: after
// `orca terminal close --terminal <h> --tab`, `run-show --full` gave
// `coordinator_handle: null`. `run-use` from a new tab binds the Run again
// (seen live: unpause after a pause worked, and a waiting letter was delivered
// in the new tab). Every `orchestration check --run <id>`, peek or not, needs
// the caller to be the Run's coordinator; on a Run with no coordinator Orca
// refuses `consumer_fenced`, "This caller does not coordinate Run <id>, which
// has no coordinator now. Nothing changed." (check-run.ts, run-scope.ts
// `resolveRunScope`).
//
// What these tests pin:
//
//   R1. The fake Orca models both: from '1.4.272', `terminal close` takes every
//       Run that terminal coordinated off it (null, generation up by one), and
//       a check of a Run with no coordinator is refused in Orca's words, with
//       nothing done. Older, or with no version, as before. `run-use` binds an
//       unbound Run again.
//   R2. On 1.4.272, `obk message check` from a plain shell, for a session that
//       is paused, of a bot that is paused, or whose tab Orca closed: fails
//       plainly (non-zero, as the kit's answer for a mailbox bound to no tab
//       does today), reads nothing, binds nothing, and leaves the letter
//       waiting; its answer, in the plain text and in `--json`'s `trouble`,
//       says the mailbox is bound to no tab and the mail waits, and names the
//       command that starts the session: `<cli> unpause --bots <bots> --bot
//       <bot> --session <session>` for a paused session, the bot's `unpause`
//       with no `--session` for a paused bot, and `<cli> up --bots <bots>
//       --bot <bot> --session <session>` for a session whose tab is just
//       closed. After `unpause`, the new tab coordinates the Run and a check
//       there gets the letter.
//   R3. A `--peek` the same.
//   R4. On 1.4.271 the #249 read holds: from a plain shell, a paused session's
//       mail is read as the closed tab's handle, and nothing is bound.
//
// The words are the kit's. What is pinned is the exit code, Orca's state, the
// Orca calls, and the start command, with the kit's own CLI and the bots folder
// in either spelling a shell reads as one word (helpers/cli.js, spellingsOf),
// as message-no-open-tab.test.js pins it. Everything runs through the CLI on a
// sandboxed bots folder against the fake Orca, or straight against the fake.
//
// Out of scope: a session whose tab is live (#228), a check typed inside
// another tab (refused before the binding is looked at, #317), Orca's notice
// rule, and the deletion of a Run (#820, #841).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  createSandbox,
  launchLineEnv,
  orcaCallsOf,
  recordSession,
  sessionIn,
  spellingsOf,
} from './helpers/cli.js';

/** The first Orca that unbinds a Run when its coordinator closes, and the last one before it. */
const UNBINDS = '1.4.272';
const KEEPS = '1.4.271';

/** Orca's words for a check of a Run with no coordinator (check-run.ts at v1.4.272). */
const noCoordinator = (run) => `This caller does not coordinate Run ${run}, which has no coordinator now. Nothing changed.`;

// ---------------------------------------------------------------------------
// R1: the fake Orca, asked straight
// ---------------------------------------------------------------------------

/**
 * Call the fake Orca the way the kit would, from a plain shell, or from inside
 * the terminal `caller` names, and give back the envelope and the exit code.
 */
function ask(box, args, caller) {
  const env = caller === undefined ? box.env : { ...box.env, ORCA_TERMINAL_HANDLE: caller };
  const done = spawnSync(box.orca.cli, [...args, '--json'], { cwd: box.cwd, env, encoding: 'utf8' });
  assert.equal(done.stderr, '', `the fake should not have complained: ${done.stderr}`);
  return { ...JSON.parse(done.stdout), exit: done.status };
}

/**
 * A fake Orca at `version` (left out: the fake as it always was) with three
 * live tabs, term_a, term_b and term_c, Run A bound to term_a and Run B to
 * term_b, and one letter waiting in A. term_c holds no Run.
 */
async function orcaWithRuns(t, version) {
  const box = await createSandbox(t);
  await box.orca.set({
    terminals: ['a', 'b', 'c'].map((n) => ({ handle: `term_${n}`, tabId: `tab_${n}`, title: n, typed: [] })),
    ...(version === undefined ? {} : { orcaVersion: version }),
  });
  const made = (from) => {
    const answer = ask(box, ['orchestration', 'run-create', '--objective', `obk ${from}`, '--from', from, '--full']);
    assert.equal(answer.ok, true, JSON.stringify(answer));
    return answer.result.run.id;
  };
  const a = made('term_a');
  const b = made('term_b');
  const sent = ask(box, ['orchestration', 'send', '--to', `run:${a}`, '--subject', 'note 1', '--body', 'b', '--from', `run:${b}`]);
  assert.equal(sent.ok, true, JSON.stringify(sent));
  return { box, a, b };
}

/** Orca's record of one Run. */
const runOf = async (box, id) => (await box.orca.runs()).find((run) => run.id === id);

/** The subjects of the letters still unread. */
const unread = async (box) => (await box.orca.messages()).filter((message) => !message.acked).map((message) => message.subject);

for (const [how, flags] of [['its tab', ['--tab']], ['its pane', []]]) {
  test(`#858 R1: on Orca ${UNBINDS}, closing ${how} takes the Run its terminal coordinated off it, the generation up by one, and no other Run`, async (t) => {
    const { box, a, b } = await orcaWithRuns(t, UNBINDS);

    const closed = ask(box, ['terminal', 'close', '--terminal', 'term_a', ...flags]);

    assert.equal(closed.ok, true, JSON.stringify(closed));
    const run = await runOf(box, a);
    assert.equal(run.coordinator_handle, null, `the closed terminal no longer coordinates ${a}, got: ${JSON.stringify(run)}`);
    assert.equal(run.consumer_generation, 1, `and its consumer generation went up by one, got: ${JSON.stringify(run)}`);
    const other = await runOf(box, b);
    assert.equal(other.coordinator_handle, 'term_b', `${b} is still bound to its own tab, got: ${JSON.stringify(other)}`);
    assert.equal(other.consumer_generation, 0, `and its generation did not move, got: ${JSON.stringify(other)}`);
    assert.deepEqual(await unread(box), ['note 1'], 'the letter still waits');
  });
}

/** Every way a check can be asked of a Run: who asks, and with what. */
const CHECKS = [
  ['from a plain shell, as the closed handle', (run) => ['--run', run, '--terminal', 'term_a'], undefined],
  ['from a plain shell, as the closed handle, a peek', (run) => ['--run', run, '--terminal', 'term_a', '--peek'], undefined],
  ['from a plain shell, naming no terminal', (run) => ['--run', run], undefined],
  ['from a plain shell, naming no terminal, a peek', (run) => ['--run', run, '--peek'], undefined],
  ['from a live tab that holds no Run', (run) => ['--run', run], 'term_c'],
  ['from a live tab that holds no Run, a peek', (run) => ['--run', run, '--peek'], 'term_c'],
  ['from a live tab that holds another Run', (run) => ['--run', run], 'term_b'],
];

test(`#858 R1: on Orca ${UNBINDS}, every check of a Run whose coordinator closed is refused consumer_fenced in Orca's words, and nothing changes`, async (t) => {
  const { box, a } = await orcaWithRuns(t, UNBINDS);
  assert.equal(ask(box, ['terminal', 'close', '--terminal', 'term_a', '--tab']).ok, true);
  const before = await box.orca.state();

  for (const [who, flagsFor, caller] of CHECKS) {
    const refused = ask(box, ['orchestration', 'check', ...flagsFor(a)], caller);

    assert.equal(refused.ok, false, `${who}: the check is refused, got: ${JSON.stringify(refused)}`);
    assert.equal(refused.exit, 1, `${who}: with exit 1`);
    assert.equal(refused.error.code, 'consumer_fenced', `${who}: as consumer_fenced, got: ${JSON.stringify(refused)}`);
    assert.equal(refused.error.message, noCoordinator(a), `${who}: in Orca's words`);
  }
  assert.deepEqual(await box.orca.state(), before, 'nothing changed: no Run bound, no letter taken, no delivery or receipt kept');
});

test(`#858 R1: on Orca ${UNBINDS}, a Run left with no coordinator because its terminal was bound to another Run is refused the same way`, async (t) => {
  // Orca's rule is about the Run having no coordinator, however it came to have none.
  const { box, a, b } = await orcaWithRuns(t, UNBINDS);
  assert.equal(ask(box, ['orchestration', 'run-use', '--id', b, '--from', 'term_a', '--full']).ok, true);
  assert.equal((await runOf(box, a)).coordinator_handle, null, 'the premise: term_a now holds B, and A has no coordinator');
  const before = await box.orca.state();

  const refused = ask(box, ['orchestration', 'check', '--run', a, '--peek']);

  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.equal(refused.error.code, 'consumer_fenced');
  assert.equal(refused.error.message, noCoordinator(a));
  assert.deepEqual(await box.orca.state(), before, 'and nothing changed');
});

test(`#858 R1: on Orca ${UNBINDS}, run-use from a new tab binds the unbound Run again, and a check as that tab reads the letter`, async (t) => {
  const { box, a } = await orcaWithRuns(t, UNBINDS);
  assert.equal(ask(box, ['terminal', 'close', '--terminal', 'term_a', '--tab']).ok, true);

  const bound = ask(box, ['orchestration', 'run-use', '--id', a, '--full'], 'term_c');
  const read = ask(box, ['orchestration', 'check', '--run', a], 'term_c');

  assert.equal(bound.ok, true, JSON.stringify(bound));
  assert.equal((await runOf(box, a)).coordinator_handle, 'term_c', 'the new tab coordinates the Run');
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.deepEqual(read.result.messages.map((message) => message.subject), ['note 1'], 'and reads the letter that waited');
  assert.deepEqual(await unread(box), [], 'which is taken');
});

for (const [label, version] of [[`Orca ${KEEPS}`, KEEPS], ['the fake with no version set', undefined]]) {
  test(`#858 R1: on ${label}, closing a tab leaves its handle on the Run, and a check as that handle from a plain shell reads the letter`, async (t) => {
    // A description of the fake as it is before #858: kept, so the boundary
    // holds on both sides.
    const { box, a } = await orcaWithRuns(t, version);

    assert.equal(ask(box, ['terminal', 'close', '--terminal', 'term_a', '--tab']).ok, true);
    const run = await runOf(box, a);
    const read = ask(box, ['orchestration', 'check', '--run', a, '--terminal', 'term_a']);

    assert.equal(run.coordinator_handle, 'term_a', `the closed handle stays the coordinator, got: ${JSON.stringify(run)}`);
    assert.equal(run.consumer_generation, 0, `and the generation does not move, got: ${JSON.stringify(run)}`);
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.deepEqual(read.result.messages.map((message) => message.subject), ['note 1'], 'the check reads the letter');
  });
}

// ---------------------------------------------------------------------------
// The fleet, through the CLI
// ---------------------------------------------------------------------------

/** The environment of a command a session's harness runs inside `terminal` (#408). */
const inTab = (box, terminal) => ({
  ...box.env,
  ORCA_TERMINAL_HANDLE: terminal.handle,
  ORCA_TAB_ID: terminal.tabId,
  ...launchLineEnv(box),
});

/** Run `obk <args>` inside `terminal`, or from a plain shell outside Orca when it is null. */
const obkFrom = (box, terminal, args) => box.run(args, terminal === null ? {} : { env: inTab(box, terminal) });

/** The same, and insist it worked. */
async function obkIn(box, terminal, args) {
  const result = await obkFrom(box, terminal, args);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/** `obk message check` of coder/daily by name. */
const checkCoder = (flags = []) => ['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily', ...flags];

/** The fake Orca's terminal for one session's tab, as the book names it, or undefined when Orca lists none. */
async function listedTab(box, bots, bot = 'coder', session = 'daily') {
  const { tab } = await sessionIn(bots, bot, session);
  return (await box.orca.terminals()).find((entry) => entry.tabId === tab);
}

/** The subject of the letter that waits for coder/daily. */
const WAITING = 'while you were away';

/** A letter from Bot Father's session to coder/daily, sent from a plain shell. */
const mail = (box, subject) => obkIn(box, null, [
  'message', 'send', '--bots', 'bots', '--to', 'coder/daily', '--from', 'bot-father/daily',
  '--subject', subject, '--text', 'Please look at the staging host.',
]);

/**
 * A fleet on Orca `version`, brought up from a plain shell, with coder (a Codex
 * bot) running a conversation the book knows, its Run bound to its own tab.
 */
async function coderUp(box, version) {
  await box.orca.set({ orcaVersion: version });
  await obkIn(box, null, ['init', '--bots', 'bots', '--harness', 'claude']);
  const bots = box.path('bots');
  await obkIn(box, null, ['bot', 'create', '--bots', 'bots', '--name', 'coder', '--harness', 'codex']);
  await obkIn(box, null, ['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'daily']);
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  const tab = await listedTab(box, bots);
  assert.ok(tab !== undefined, 'the premise: coder/daily is up in a tab');
  // A pause closes a tab only when the book can bring its conversation back.
  const hooked = await recordSession(box, { bots, bot: 'coder', tab: tab.tabId, session: 'sess-1' });
  assert.equal(hooked.code, 0, hooked.stderr);
  const { mailbox } = await sessionIn(bots, 'coder', 'daily');
  assert.equal((await runOf(box, mailbox)).coordinator_handle, tab.handle, 'the premise: coder\'s Run starts in its own tab');
  return { bots, tab, mailbox };
}

/** Each way the kit may spell `<cli> <verb> --bots <bots> --bot <bot>`. */
const commandsOf = (box, bots, verb, bot) => spellingsOf(box.cli)
  .flatMap((cli) => spellingsOf(bots).map((folder) => `${cli} ${verb} --bots ${folder} --bot ${bot}`));

/** Whether `text` gives one of `starts` as a command of its own: nothing of a word or a `--session` runs on after it. */
const givesStart = (text, starts) => starts.some((command) => {
  for (let at = text.indexOf(command); at >= 0; at = text.indexOf(command, at + 1)) {
    const rest = text.slice(at + command.length);
    if (!/^[A-Za-z0-9_-]/.test(rest) && !/^\s*--session\b/.test(rest)) return true;
  }
  return false;
});

/**
 * The ways coder/daily has no live tab on Orca 1.4.272, each with how the test
 * makes it so and the command that starts it again, in every spelling the kit
 * may give it.
 */
const NO_TAB = {
  'paused': {
    make: (box) => obkIn(box, null, ['pause', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']),
    starts: (box, bots) => commandsOf(box, bots, 'unpause', 'coder').map((one) => `${one} --session daily`),
  },
  'of a paused bot': {
    make: (box) => obkIn(box, null, ['pause', '--bots', 'bots', '--bot', 'coder']),
    starts: (box, bots) => commandsOf(box, bots, 'unpause', 'coder'),
  },
  'whose tab Orca closed': {
    // The user closed the tab, or Orca did: Orca's own close, not the kit's.
    make: (box, fleet) => {
      const closed = ask(box, ['terminal', 'close', '--terminal', fleet.tab.handle, '--tab']);
      assert.equal(closed.ok, true, JSON.stringify(closed));
    },
    starts: (box, bots) => commandsOf(box, bots, 'up', 'coder').map((one) => `${one} --session daily`),
  },
};

/**
 * coderUp on 1.4.272, then coder/daily left with no live tab the way `way`
 * names, and a letter sent to it. Checks the premise: Orca lists no tab for
 * it, and its Run has no coordinator.
 */
async function unboundCoder(box, way) {
  const fleet = await coderUp(box, UNBINDS);
  await NO_TAB[way].make(box, fleet);
  assert.equal(await listedTab(box, fleet.bots), undefined, `the premise: Orca lists no tab for coder/daily once it is ${way}`);
  const run = await runOf(box, fleet.mailbox);
  assert.equal(run.coordinator_handle, null, `the premise: on Orca ${UNBINDS} its Run has no coordinator, got: ${JSON.stringify(run)}`);
  await mail(box, WAITING);
  return fleet;
}

/** Everything a command said, on either stream. */
const saidBy = (result) => result.stdout + result.stderr;

/** A failure a caller can act on: a non-zero exit, something said, and no crash. */
function assertFailedPlainly(result) {
  assert.ok(result.code !== 0 && result.code !== null, `this should have failed, got exit ${result.code}:\n${saidBy(result)}`);
  const said = saidBy(result);
  assert.notEqual(said.trim(), '', 'a command that says nothing is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
}

/** That the mailbox is bound to no tab. */
const NO_TAB_WORDS = /\bbound to no\b|\bno tab\b|\bnot bound\b|\bno coordinator\b/i;

const ways = [
  ['a check', []],
  ['a peek', ['--peek']],
];

// ---------------------------------------------------------------------------
// R2 and R3: on 1.4.272, nothing read, nothing bound, and the start command
// ---------------------------------------------------------------------------

for (const way of Object.keys(NO_TAB)) {
  for (const [how, flags] of ways) {
    const r = flags.includes('--peek') ? 'R3' : 'R2';

    test(`#858 ${r}: on Orca ${UNBINDS}, ${how} from a plain shell of a session ${way} fails plainly, reads nothing, binds nothing, and the letter still waits`, async (t) => {
      const box = await createSandbox(t);
      const fleet = await unboundCoder(box, way);
      const runs = await box.orca.runs();
      const from = (await box.orca.calls()).length;

      const result = await obkFrom(box, null, checkCoder(flags));

      assertFailedPlainly(result);
      assert.ok(!result.stdout.includes(WAITING), `nothing is read, got:\n${saidBy(result)}`);
      const since = (await box.orca.calls()).slice(from);
      for (const binding of ['orchestration run-use', 'orchestration run-create']) {
        assert.deepEqual(orcaCallsOf(since, binding).map((call) => call.args.join(' ')), [], `no ${binding} reached Orca`);
      }
      assert.deepEqual(await box.orca.runs(), runs, 'Orca\'s Runs are as they were: coder\'s is still bound to no terminal');
      assert.equal((await runOf(box, fleet.mailbox)).coordinator_handle, null, 'coder\'s Run has no coordinator still');
      assert.deepEqual(await unread(box), [WAITING], 'and the letter still waits, unread');
    });

    test(`#858 ${r}: on Orca ${UNBINDS}, ${how} from a plain shell of a session ${way} says the mailbox is bound to no tab, that the mail waits, and names the command that starts it, in text and in --json`, async (t) => {
      const box = await createSandbox(t);
      const fleet = await unboundCoder(box, way);
      const starts = NO_TAB[way].starts(box, fleet.bots);

      const text = await obkFrom(box, null, checkCoder(flags));
      const json = await obkFrom(box, null, checkCoder([...flags, '--json']));

      assertFailedPlainly(text);
      const said = saidBy(text);
      assert.ok(givesStart(said, starts), `it names the start command, one of ${JSON.stringify(starts)}, got:\n${said}`);
      assert.match(said, NO_TAB_WORDS, `it says the mailbox is bound to no tab, got:\n${said}`);
      assert.match(said, /\bwait/i, `and that the mail waits, got:\n${said}`);
      assert.doesNotMatch(said, /nothing is waiting/i, `the mail is waiting, so it must not say nothing is, got:\n${said}`);

      assert.notEqual(json.code, 0, `--json fails the same way, got exit ${json.code}:\n${saidBy(json)}`);
      let answer;
      try {
        answer = JSON.parse(json.stdout);
      } catch (error) {
        assert.fail(`--json should print JSON, got: ${json.stdout} (${error.message})`);
      }
      assert.deepEqual(answer.messages, [], `it answers no letters, got: ${JSON.stringify(answer)}`);
      assert.equal(answer.mailbox, fleet.mailbox, `it names coder's mailbox, got: ${JSON.stringify(answer)}`);
      assert.equal(typeof answer.trouble, 'string', `and says what is wrong, got: ${JSON.stringify(answer)}`);
      assert.ok(givesStart(answer.trouble, starts), `the trouble names the start command, one of ${JSON.stringify(starts)}, got: ${answer.trouble}`);
      assert.match(answer.trouble, NO_TAB_WORDS, `the trouble says the mailbox is bound to no tab, got: ${answer.trouble}`);
      assert.match(answer.trouble, /\bwait/i, `and that the mail waits, got: ${answer.trouble}`);
      assert.deepEqual(await unread(box), [WAITING], 'neither check took the letter');
    });
  }
}

test(`#858 R2: on Orca ${UNBINDS}, after a refused check of a paused session, unpause binds its Run to its new tab, and a check there gets the letter`, async (t) => {
  const box = await createSandbox(t);
  const fleet = await unboundCoder(box, 'paused');
  await obkFrom(box, null, checkCoder());

  await obkIn(box, null, ['unpause', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);

  const now = await listedTab(box, fleet.bots);
  assert.ok(now !== undefined, 'coder/daily is up in a tab again');
  assert.notEqual(now.handle, fleet.tab.handle, 'a new one');
  assert.equal((await sessionIn(fleet.bots, 'coder', 'daily')).mailbox, fleet.mailbox, 'it keeps the mailbox it had');
  assert.equal((await runOf(box, fleet.mailbox)).coordinator_handle, now.handle, 'and its new tab coordinates it');
  const read = await obkFrom(box, now, checkCoder());
  assert.equal(read.code, 0, `a check in the new tab works:\n${saidBy(read)}`);
  assert.ok(read.stdout.includes(WAITING), `and gets the letter that waited, got:\n${saidBy(read)}`);
  assert.deepEqual(await unread(box), [], 'which is taken');
});

// ---------------------------------------------------------------------------
// R4: just below the boundary, the #249 read holds
// ---------------------------------------------------------------------------

for (const [how, flags, takes] of [['a check', [], true], ['a peek', ['--peek'], false]]) {
  test(`#858 R4: on Orca ${KEEPS}, ${how} from a plain shell of a paused session reads its mail as the closed tab, and binds nothing`, async (t) => {
    // A description of the kit as it is before #858 (#249): kept, so the
    // version boundary is pinned on both sides.
    const box = await createSandbox(t);
    const fleet = await coderUp(box, KEEPS);
    await obkIn(box, null, ['pause', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);
    assert.equal(await listedTab(box, fleet.bots), undefined, 'the premise: pause closed coder\'s tab');
    assert.equal((await runOf(box, fleet.mailbox)).coordinator_handle, fleet.tab.handle, `the premise: on ${KEEPS} the closed tab stays the coordinator`);
    await mail(box, WAITING);
    const runs = await box.orca.runs();
    const from = (await box.orca.calls()).length;

    const read = await obkIn(box, null, checkCoder(flags));

    assert.ok(read.stdout.includes(WAITING), `the check reads coder's mail, got:\n${saidBy(read)}`);
    assert.deepEqual(await unread(box), takes ? [] : [WAITING], takes ? 'a plain check takes the letter' : 'a peek leaves it');
    const since = (await box.orca.calls()).slice(from);
    assert.deepEqual(orcaCallsOf(since, 'orchestration run-use').map((call) => call.args.join(' ')), [], 'no run-use reached Orca');
    assert.deepEqual(await box.orca.runs(), runs, 'Orca\'s Runs are as they were: coder\'s still names its closed tab');
  });
}
