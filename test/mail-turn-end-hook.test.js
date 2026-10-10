// The turn-end reminder of unread fleet mail on Claude Code (#509,
// requests/fleet-mail-one-signal, R4 and R5).
//
// A Claude Code receiver that was busy when mail came, or that started a turn
// of other work, gets nothing typed into its tab (mail-one-signal.test.js).
// What tells it instead is a hook of the kit's in its own session, at the end
// of each turn:
//
//   T1  `obk up` writes it into the bot's `.claude/settings.json`: under
//       `Stop`, in a group with no matcher, one kit entry
//         { "type": "command",
//           "command": "<kit cli> session mail --bots <bots> --bot <bot> 2>/dev/null || true",
//           "timeout": 30 }
//       the command quoted the way the kit's other hook commands are. `obk
//       health` names a bot whose file lacks it, as it does the kit's other
//       hooks.
//   T2  A Codex bot's `.codex/hooks.json` stays exactly as it is today: no new
//       entry and no change to an old one, since either puts every Codex
//       session on "Hooks need review" (Out, in the request).
//   T3  Run as Claude Code runs it (the Stop event on stdin, Orca's
//       ORCA_TAB_ID and ORCA_TERMINAL_HANDLE of the session's own tab), when
//       mail the kit sent to this session is still unread (Orca's `check
//       --peek` as its own tab still lists it), it prints exactly one JSON
//       object, `{"hookSpecificOutput":{"hookEventName":"Stop",
//       "additionalContext":"<text>"}}`, and exits 0: no `decision` and no
//       `reason`, so Claude Code 2.1.296 draws it as "Stop hook feedback", not
//       as "Stop hook error" (the architect's ruling). The text starts "A
//       fleet mail" or "<n> fleet mails", and names each message's sender
//       `<bot>/<session>`, its subject, "still unread", when it came, and the
//       `message check` command to read it with. It reads nothing: the mail is
//       still unread after it.
//   T4  Once for each message: a second turn end with the same mail prints
//       nothing, and a later message is told on its own.
//   T5  Nothing on stdout, exit 0: with `stop_hook_active: true` (and the mail
//       is told at the next turn end that is not); after `obk message check`
//       read it; when Orca no longer lists it as unread (read another way);
//       when Orca refuses, is down, or does not answer; when the kit's record
//       cannot be read; when the tab is not in the book.
//   T6  With no record of unread mail for this session, it does not call Orca.
//
// The hook is run here by its command line, through the process chain a
// harness makes (helpers/cli.js `throughAHarness`), without the `2>/dev/null
// || true` the installed line adds, so its own exit code and stderr show; one
// test runs the installed line itself.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME and TMPDIR, a
// fake Orca. Nothing here reaches the real Orca or a real harness.

import assert from 'node:assert/strict';
import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  createSandbox,
  eventsIn,
  hookFileOf,
  hooksIn,
  kitHooksIn,
  kitLaunchMark,
  orcaCallsOf,
  recordSession,
  sessionIn,
  shellWord,
  spellingsOf,
  throughAHarness,
} from './helpers/cli.js';

/** The Claude Code bot that receives, and the two Codex bots that write to it down the Orca road. */
const READER = 'writer';
const SENDERS = ['coder', 'tester'];

/** Root reads a folder whatever its mode, so a record made unreadable that way stays readable. */
const NEEDS_A_USER = process.getuid?.() === 0 && 'runs as root, which reads a folder whatever its mode';

/** The conversation the book holds for the reader's session, and the one its Stop events name. */
const CONVERSATION = '0199b2c0-0509-4444-8888-c1a0de000001';

/**
 * The bots up, each tab busy with a turn of its own, so a send to the reader
 * types nothing and returns at once (signal hook, because busy). The book
 * holds CONVERSATION for the reader's session, as the kit's SessionStart hook
 * writes it; with `conversation: false` it holds none.
 */
async function fleetIn(box, { conversation = true } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [[READER, 'claude'], ...SENDERS.map((one) => [one, 'codex'])]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  const tab = (await sessionIn(bots, READER, 'daily')).tab;
  const terminals = await box.orca.terminals();
  const terminal = terminals.find((one) => one.tabId === tab);
  assert.ok(terminal, `the premise: Orca has ${READER}'s tab`);
  if (conversation) {
    const heard = await recordSession(box, { bots, bot: READER, tab, session: CONVERSATION });
    assert.equal(heard.code, 0, `the premise: the book holds the reader's conversation: ${heard.stderr}`);
    assert.equal((await sessionIn(bots, READER, 'daily')).session, CONVERSATION, 'the premise: the book holds the reader\'s conversation');
  }
  // Every tab busy, so no send in this file waits out the 8 s watch.
  await box.orca.set({ terminals: terminals.map((one) => ({ ...one, tuiIdle: 'busy' })) });
  return { bots, tab, terminal };
}

/** One message to the reader from `from` (`<bot>/daily`), which must go. */
async function mail(box, from, subject, text = 'It is down again.') {
  const sent = await box.run([
    'message', 'send', '--bots', 'bots', '--to', READER, '--from', `${from}/daily`,
    '--subject', subject, '--text', text, '--json',
  ]);
  assert.equal(sent.code, 0, `the premise: the mail went: ${sent.stdout}${sent.stderr}`);
  assert.equal(JSON.parse(sent.stdout).sent, true, `the premise: the mail went: ${sent.stdout}`);
}

/** What Claude Code hands a Stop hook on stdin. */
const stopEvent = (fleet, { active = false, session = CONVERSATION } = {}) => `${JSON.stringify({
  session_id: session,
  transcript_path: '/nowhere/transcript.jsonl',
  cwd: path.join(fleet.bots, 'bots', READER),
  hook_event_name: 'Stop',
  stop_hook_active: active,
})}\n`;

/** The hook's command line, without the installed `2>/dev/null || true`. */
const mailCommand = (box, fleet) => [box.cli, 'session', 'mail', '--bots', fleet.bots, '--bot', READER].map(shellWord).join(' ');

/**
 * A turn end of the reader's session: the hook, run as Claude Code runs it in
 * the session's own tab. `tab` and `handle` stand in for another tab's; `null`
 * for either leaves that variable out (a default would fill in `undefined`).
 */
const turnEnds = (box, fleet, { active = false, session = CONVERSATION, nested = false, command = mailCommand(box, fleet), tab = fleet.tab, handle = fleet.terminal.handle, env } = {}) => throughAHarness(box, command, {
  tab: tab ?? undefined,
  nested,
  stdin: stopEvent(fleet, { active, session }),
  env: { ...(env ?? box.env), ...(handle === null ? {} : { ORCA_TERMINAL_HANDLE: handle }), ...kitLaunchMark(box, fleet.terminal) },
});

/**
 * A turn end that tells: exit 0, and on stdout exactly one JSON object,
 * `{ hookSpecificOutput: { hookEventName: 'Stop', additionalContext } }`, with
 * nothing else in it: no `decision` and no `reason`, which Claude Code draws as
 * an error. The text starts with plain words that say it is fleet mail.
 * Returns the text.
 */
function toldIn(ran) {
  assert.equal(ran.code, 0, `the hook exits 0: ${ran.stdout}${ran.stderr}`);
  let said;
  try {
    said = JSON.parse(ran.stdout);
  } catch (error) {
    return assert.fail(`the hook prints one JSON object, got: ${JSON.stringify(ran.stdout)} ${ran.stderr} (${error.message})`);
  }
  assert.ok(said !== null && typeof said === 'object' && !Array.isArray(said), `one JSON object, got: ${ran.stdout}`);
  assert.deepEqual(Object.keys(said), ['hookSpecificOutput'], `hookSpecificOutput and nothing else: no decision, no reason, got: ${ran.stdout}`);
  const { hookEventName, additionalContext, ...more } = said.hookSpecificOutput ?? {};
  assert.equal(hookEventName, 'Stop', `the Stop event's context, got: ${ran.stdout}`);
  assert.deepEqual(more, {}, `and nothing else in it, got: ${ran.stdout}`);
  assert.equal(typeof additionalContext, 'string', `the text in additionalContext, got: ${ran.stdout}`);
  assert.match(additionalContext, /^(?:A fleet mail|\d+ fleet mails)\b/, `it starts by saying it is fleet mail, not a fault: ${additionalContext}`);
  return additionalContext;
}

/** A turn end that says nothing: exit 0 and an empty stdout. */
function assertSilent(ran, why) {
  assert.equal(ran.code, 0, `the hook exits 0 (${why}): ${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout, '', `nothing on stdout (${why}), got: ${ran.stdout}`);
}

/** Every file under a folder, however deep. */
async function filesUnder(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(full));
    else found.push(full);
  }
  return found;
}

/** The kit's record of unread mail: `obk-unread` in its system temp folder, which a send has made. */
async function unreadDir(box) {
  const dir = path.join(box.tmp, 'obk-unread');
  const there = await stat(dir).then((found) => found.isDirectory(), () => false);
  assert.ok(there, `the premise: the send left the kit's record of unread mail in ${dir}`);
  return dir;
}

// ------------------------------------------------------------ T1, T2: the entry

/** Whether a hook entry runs the kit's `session mail`. */
const runsMail = (entry) => /\bsession mail\b/.test(String(entry?.command));

/** The kit's line, in each spelling of the kit's path it may use. */
const mailHookLines = (box, bots, bot = READER) => spellingsOf(box.cli).map(
  (cli) => `${cli} session mail --bots ${shellWord(bots)} --bot ${shellWord(bot)} 2>/dev/null || true`,
);

test('T1 up writes the kit\'s Stop hook into a Claude Code bot\'s .claude/settings.json: no matcher, one entry, 30 s', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);

  const held = await hooksIn(fleet.bots, READER, 'claude');

  assert.ok(held !== undefined, 'the premise: the Claude Code bot has its settings file');
  const text = JSON.stringify(eventsIn(held));
  const groups = (eventsIn(held).Stop ?? []).filter((group) => (group?.hooks ?? []).some(runsMail));
  assert.equal(groups.length, 1, `one Stop group holds the kit's entry: ${text}`);
  assert.equal('matcher' in groups[0], false, `a group with no matcher: ${JSON.stringify(groups[0])}`);
  const [entry, ...more] = groups[0].hooks.filter(runsMail);
  assert.deepEqual(more, [], `one kit entry in it: ${JSON.stringify(groups[0])}`);
  assert.ok(mailHookLines(box, fleet.bots).includes(entry.command), `the kit's line, one of ${JSON.stringify(mailHookLines(box, fleet.bots))}, got: ${entry.command}`);
  assert.deepEqual(entry, { type: 'command', command: entry.command, timeout: 30 }, 'a command entry, 30 s, and nothing else');
  const elsewhere = Object.entries(eventsIn(held)).filter(([event, groupsOf]) => event !== 'Stop' && JSON.stringify(groupsOf).includes('session mail'));
  assert.deepEqual(elsewhere, [], `and no such entry under any other event: ${text}`);
  assert.equal(kitHooksIn(held).length, 1, 'beside the kit\'s SessionStart entry, which stays');
});

test('T1 a second up writes nothing new to the Claude Code settings', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  const file = hookFileOf(fleet.bots, READER, 'claude');
  const before = await readFile(file, 'utf8');
  // The hooks part only: since #527 permissions.allow names `session mail` as a default rule.
  assert.ok(JSON.stringify(JSON.parse(before).hooks ?? {}).includes('session mail'), `the premise: the first up wrote the hook: ${before}`);

  const again = await box.run(['up', '--bots', 'bots', '--bot', READER]);

  assert.equal(again.code, 0, again.stderr);
  assert.equal(await readFile(file, 'utf8'), before, 'nothing to add, so nothing written');
});

test('T1 health names a Claude Code bot whose settings lack the Stop hook, says obk up puts it back, and exits 1; nothing when it is there', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  const file = hookFileOf(fleet.bots, READER, 'claude');
  const health = async () => {
    const result = await box.run(['health', '--bots', 'bots', '--json']);
    const answer = JSON.parse(result.stdout);
    return { code: result.code, found: answer.found.filter((one) => `${one.where} ${one.says}`.includes(file)) };
  };

  const whole = await health();
  assert.deepEqual(whole.found, [], `the hook is there, so nothing about ${file}: ${JSON.stringify(whole.found)}`);

  const held = JSON.parse(await readFile(file, 'utf8'));
  eventsIn(held).Stop = (eventsIn(held).Stop ?? [])
    .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((entry) => !runsMail(entry)) }))
    .filter((group) => group.hooks.length > 0);
  if (eventsIn(held).Stop.length === 0) delete eventsIn(held).Stop;
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
  assert.equal(kitHooksIn(held).length, 1, 'the premise: the SessionStart entry is as up wrote it');

  const { code, found } = await health();
  assert.equal(found.length, 1, `one finding names ${file}, whose Stop hook is gone: ${JSON.stringify(found)}`);
  assert.match(found[0].says, /\bStop\b|session mail/, `and says which hook: ${found[0].says}`);
  assert.match(found[0].says, /\bobk up\b/, `and that obk up puts it back: ${found[0].says}`);
  assert.equal(code, 1, 'a finding exits 1');
});

test('T2 a Codex bot\'s .codex/hooks.json is exactly as before #509: its three kit entries and nothing else, after up and after a second up', async (t) => {
  // Written out from the hooks a Codex bot had before this change (src/hooks.js
  // at 0.25.2): any new or changed entry puts every Codex session on Codex's
  // "Hooks need review" screen.
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  const file = hookFileOf(fleet.bots, 'coder', 'codex');
  const line = (word) => `${shellWord(box.cli)} session ${word} --bots ${shellWord(fleet.bots)} --bot coder 2>/dev/null || true`;
  const expected = {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: line('record'), timeout: 10 }] }],
      PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: line('nudge'), timeout: 30 }] }],
      Stop: [{ hooks: [{ type: 'command', command: line('name'), timeout: 300, async: true }] }],
    },
  };

  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), expected, 'as before');
  const claude = await hooksIn(fleet.bots, READER, 'claude');
  assert.ok(JSON.stringify(claude.hooks ?? {}).includes('session mail'), `the contrast: the Claude Code bot beside it has the new hook: ${JSON.stringify(claude.hooks)}`);
  const before = await readFile(file, 'utf8');
  const again = await box.run(['up', '--bots', 'bots', '--bot', 'coder']);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(await readFile(file, 'utf8'), before, 'and a second up writes nothing');
});

// ------------------------------------------------------------ T3: it tells

test('T3 the installed line, run at a turn end in the session\'s tab with mail unread, tells it as the Stop hook\'s context', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  const [entry] = (eventsIn(await hooksIn(fleet.bots, READER, 'claude'))?.Stop ?? []).flatMap((group) => group.hooks ?? []).filter(runsMail);
  assert.equal(typeof entry?.command, 'string', 'the premise: up wrote the kit\'s Stop hook');
  await mail(box, 'coder', 'the staging host');

  const reason = toldIn(await turnEnds(box, fleet, { command: entry.command }));

  assert.ok(reason.includes('the staging host'), `it names the mail: ${reason}`);
});

test('T3 the text names the sender, the subject, says still unread, when it came, and how to read it', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');

  const reason = toldIn(await turnEnds(box, fleet));

  assert.match(reason, /^A fleet mail\b/, `one mail: it starts "A fleet mail": ${reason}`);
  assert.ok(reason.includes('coder/daily'), `the sender as <bot>/<session>: ${reason}`);
  assert.ok(reason.includes('the staging host'), `the subject: ${reason}`);
  assert.match(reason, /still unread/, `"still unread", so it does not read as new mail: ${reason}`);
  assert.match(reason, /\d{1,2}:\d{2}|\bago\b|just now/i, `when it came: ${reason}`);
  assert.ok(reason.includes('message check'), `the command to read it with: ${reason}`);
  assert.ok(reason.includes(`--bot ${READER}`) && reason.includes('--session daily'), `for this session: ${reason}`);
  assert.ok(spellingsOf(fleet.bots).some((bots) => reason.includes(`--bots ${bots}`)), `in this bots folder: ${reason}`);
});

test('T3 two unread messages from two senders are both in the text, which starts "2 fleet mails"', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');
  await mail(box, 'tester', 'the flaky test');

  const reason = toldIn(await turnEnds(box, fleet));

  assert.match(reason, /^2 fleet mails\b/, `it starts with how many: ${reason}`);
  for (const said of ['coder/daily', 'the staging host', 'tester/daily', 'the flaky test']) {
    assert.ok(reason.includes(said), `${said} is in the text: ${reason}`);
  }
});

test('T3 the hook asks Orca with a peek as the session\'s own tab, and reads nothing: the mail is still unread after it', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');
  const from = (await box.orca.calls()).length;

  toldIn(await turnEnds(box, fleet));

  const checks = orcaCallsOf((await box.orca.calls()).slice(from), 'orchestration check');
  assert.ok(checks.length > 0, 'it asked Orca whether the mail is still unread');
  for (const call of checks) {
    assert.ok(call.args.includes('--peek'), `only a peek, never a read: ${call.args.join(' ')}`);
    assert.equal(call.caller, fleet.terminal.handle, `as the session's own tab: ${JSON.stringify(call)}`);
  }
  assert.deepEqual((await box.orca.messages()).map((one) => one.acked), [false], 'the mail is still unread in Orca');
});

// ------------------------------------------------------------ T4: once

test('T4 each message is told once: a second turn end with the same mail unread says nothing', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');

  toldIn(await turnEnds(box, fleet));
  const second = await turnEnds(box, fleet);

  assertSilent(second, 'told once already');
  assert.deepEqual((await box.orca.messages()).map((one) => one.acked), [false], 'the premise: it is still unread');
});

test('T4 a message that came after the last reminder is told on its own, without the one told before', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');
  toldIn(await turnEnds(box, fleet));
  await mail(box, 'tester', 'the flaky test');

  const reason = toldIn(await turnEnds(box, fleet));

  assert.ok(reason.includes('the flaky test'), `the new one: ${reason}`);
  assert.ok(!reason.includes('the staging host'), `and not the one told before: ${reason}`);
});

// ------------------------------------------------------------ T5: silent

test('T5 with stop_hook_active it says nothing, and the mail is told at the next turn end that is not', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');

  assertSilent(await turnEnds(box, fleet, { active: true }), 'a stop hook is already active');
  const reason = toldIn(await turnEnds(box, fleet));

  assert.ok(reason.includes('the staging host'), `told now: ${reason}`);
});

test('T5 mail read with obk message check before the turn end: nothing', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');
  const read = await box.run(['message', 'check', '--bots', 'bots', '--bot', READER, '--session', 'daily', '--json']);
  assert.equal(read.code, 0, `the premise: the check read it: ${read.stdout}${read.stderr}`);
  assert.equal(JSON.parse(read.stdout).messages.length, 1, `the premise: the check read it: ${read.stdout}`);

  assertSilent(await turnEnds(box, fleet), 'the mail was read');
});

test('T5 a peek with obk message check --peek reads nothing, so the mail is still told', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');
  const peeked = await box.run(['message', 'check', '--bots', 'bots', '--bot', READER, '--session', 'daily', '--peek', '--json']);
  assert.equal(peeked.code, 0, `the premise: the peek ran: ${peeked.stdout}${peeked.stderr}`);

  const reason = toldIn(await turnEnds(box, fleet));

  assert.ok(reason.includes('the staging host'), `still told: ${reason}`);
});

test('T5 mail the kit\'s record lists but Orca no longer lists as unread, read another way: nothing', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');
  // Read and acknowledged with Orca's own check, which the kit's record cannot see.
  const state = await box.orca.state();
  await box.orca.set({ messages: state.messages.map((one) => ({ ...one, acked: true })) });

  assertSilent(await turnEnds(box, fleet), 'Orca has it as read');
});

for (const [what, broken] of [
  ['Orca refuses the check', { fail: { 'orchestration check': { code: 'runtime_error', message: 'something went wrong' } } }],
  ['Orca is down', { crash: { command: '*', exitCode: 1, stderr: 'orca: the app is not running\n' } }],
  ['Orca talks nonsense', { garbage: { command: 'orchestration check', text: 'not json at all\n' } }],
]) {
  test(`T5 ${what}: nothing on stdout, exit 0`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    await mail(box, 'coder', 'the staging host');
    await box.orca.set(broken);

    assertSilent(await turnEnds(box, fleet), what);
  });
}

test('T5 Orca does not answer: nothing on stdout, exit 0, well inside the hook\'s 30 s', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');
  await box.orca.set({ hang: { command: 'orchestration check', ms: 60_000 } });
  const started = Date.now();

  const ran = await turnEnds(box, fleet);

  assertSilent(ran, 'Orca did not answer');
  assert.ok(Date.now() - started < 30_000, `it gives up inside Claude Code's 30 s, took ${Date.now() - started} ms`);
});

test('T5 the kit\'s record cannot be read (every file in it is not what it wrote): nothing on stdout, exit 0', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');
  const files = await filesUnder(await unreadDir(box));
  assert.ok(files.length > 0, 'the premise: the send left a record in obk-unread');
  for (const file of files) await writeFile(file, 'not what the kit wrote {{{\n');

  assertSilent(await turnEnds(box, fleet), 'the record is not readable');
});

test('T5 the kit\'s record folder cannot be opened: nothing on stdout, exit 0', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');
  const dir = await unreadDir(box);
  await chmod(dir, 0o000);
  let ran;
  try {
    ran = await turnEnds(box, fleet);
  } finally {
    // Opened again before the sandbox is taken away, which a shut folder would stop.
    await chmod(dir, 0o700);
  }

  assertSilent(ran, 'the record folder is shut');
});

test('T5 a tab the book does not hold, or none at all: nothing on stdout, exit 0', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');

  assertSilent(await turnEnds(box, fleet, { tab: 'tab_nobody_has', handle: 'term_nobody_has' }), 'a tab nobody in the book has');
  // Run outside any Orca tab: no ORCA_TAB_ID, and so no ORCA_TERMINAL_HANDLE either.
  const outside = { ...box.env };
  delete outside.ORCA_TAB_ID;
  delete outside.ORCA_TERMINAL_HANDLE;
  assertSilent(await turnEnds(box, fleet, { tab: null, handle: null, env: outside }), 'no tab at all');
  // The contrast: in its own tab the same mail is told.
  toldIn(await turnEnds(box, fleet));
});

// ------------------------------------------------------------ T6: no record, no Orca

test('T6 with no record of unread mail for the session, the hook does not call Orca at all', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  // Mail to another session leaves a record, but none for this one.
  const other = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'tester', '--from', `${READER}/daily`,
    '--subject', 'not for the writer', '--text', 'Hello.', '--json',
  ]);
  assert.equal(other.code, 0, `the premise: the other mail went: ${other.stdout}${other.stderr}`);
  const from = (await box.orca.calls()).length;

  assertSilent(await turnEnds(box, fleet), 'no mail for it');

  assert.deepEqual((await box.orca.calls()).slice(from).map((call) => call.args.slice(0, 2).join(' ')), [], 'not one call to Orca');
});

test('T6 after obk message check read its mail, the hook does not call Orca either', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');
  const read = await box.run(['message', 'check', '--bots', 'bots', '--bot', READER, '--session', 'daily']);
  assert.equal(read.code, 0, `the premise: the check read it: ${read.stdout}${read.stderr}`);
  const from = (await box.orca.calls()).length;

  assertSilent(await turnEnds(box, fleet), 'the mail was read');

  assert.deepEqual((await box.orca.calls()).slice(from).map((call) => call.args.slice(0, 2).join(' ')), [], 'not one call to Orca');
});

// ------------------------------------------------------------ T7: only the book's conversation

// The review of PR #514: a Claude harness started inside the session (same
// bot folder, same tab variables, same project hooks) runs the same Stop hook
// with a session_id of its own. The hook tells only the conversation the book
// holds for that tab: a Stop event with any other session_id prints nothing
// and marks nothing, so the session's own later turn end still tells. With no
// conversation in the book, nothing is told and nothing is marked.

/** The id a nested harness's own conversation has. */
const NESTED = '0199b2c0-0509-4444-8888-c1a0de0000ff';

test('T7 a nested harness\'s turn end, with a session_id that is not the book\'s, says nothing and marks nothing: the session\'s own turn end still tells', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');

  const nested = await turnEnds(box, fleet, { session: NESTED, nested: true });
  const own = await turnEnds(box, fleet);

  assertSilent(nested, 'a nested harness\'s turn end');
  const text = toldIn(own);
  assert.ok(text.includes('the staging host'), `the session's own turn end tells it: ${text}`);
});

test('T7 a turn end with a session_id that is not the book\'s, in the session\'s own process chain, says nothing either', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, 'coder', 'the staging host');

  const other = await turnEnds(box, fleet, { session: NESTED });
  const own = await turnEnds(box, fleet);

  assertSilent(other, 'another conversation\'s turn end');
  toldIn(own);
});

test('T7 with no conversation in the book, a turn end tells nothing and marks nothing; once the book holds it, its turn end tells', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box, { conversation: false });
  assert.equal((await sessionIn(fleet.bots, READER, 'daily')).session, undefined, 'the premise: the book holds no conversation');
  await mail(box, 'coder', 'the staging host');

  const before = await turnEnds(box, fleet);
  const heard = await recordSession(box, { bots: fleet.bots, bot: READER, tab: fleet.tab, session: CONVERSATION });
  assert.equal(heard.code, 0, `the premise: the book now holds the conversation: ${heard.stderr}`);
  const after = await turnEnds(box, fleet);

  assertSilent(before, 'no conversation in the book');
  toldIn(after);
});

// ------------------------------------------------------------ T8: read before the send's answer

// The review of PR #514: Orca holds the message the moment it is posted, and
// answers the post a while later. Mail the receiver read with obk message
// check in that while is read: its turn end tells nothing of it.

test('T8 mail read with obk message check before the send\'s answer came back: the turn end says nothing of it', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  const sends = orcaCallsOf(await box.orca.calls(), 'orchestration send').length;
  await box.orca.set({ hang: { command: 'orchestration send', ms: 4000, applied: true, from: sends, times: 1 } });

  const sending = box.run([
    'message', 'send', '--bots', 'bots', '--to', READER, '--from', 'coder/daily',
    '--subject', 'read before the answer', '--text', 'Already read.', '--json',
  ]);
  for (let tries = 0; (await box.orca.messages()).length === 0; tries += 1) {
    assert.ok(tries < 200, 'the premise: the post reached Orca while its answer was held back');
    await sleep(25);
  }
  const read = await box.run(['message', 'check', '--bots', 'bots', '--bot', READER, '--session', 'daily', '--json']);
  const sent = await sending;

  assert.equal(read.code, 0, `the premise: the check ran: ${read.stdout}${read.stderr}`);
  assert.equal(JSON.parse(read.stdout).messages.length, 1, `the premise: the check read the mail before the send's answer: ${read.stdout}`);
  assert.equal(sent.code, 0, `the premise: the send went: ${sent.stdout}${sent.stderr}`);
  assertSilent(await turnEnds(box, fleet), 'mail read before the send\'s answer');
  // The contrast: mail sent after that read, and not read, is told.
  await mail(box, 'tester', 'the flaky test');
  const text = toldIn(await turnEnds(box, fleet));
  assert.ok(text.includes('the flaky test') && !text.includes('read before the answer'), `only the mail not read: ${text}`);
});
