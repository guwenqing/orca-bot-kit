// A Claude session's native message that went outside its bots folder is
// warned about (#451, the owner's choice: a warning only; the architect's
// ruling of 2026-10-02).
//
// Claude Code's native messaging is machine-wide. In #450 a throwaway test
// fleet's grooming session, not finding its own daily live, sent its report to
// the nearest listed name, the owner's real `bot-father.daily`, and it was
// delivered. So the kit's hook, in the bot folder beside SessionStart (ADR
// 0022), runs after each `SendMessage` of a kit-launched Claude session:
//
//   obk session sent --bots <bots> --bot <bot>
//
// Claude Code runs it as a PostToolUse hook, with the event on standard input:
// `tool_name`, `tool_input` (SendMessage's `to`, `summary`, `message`) and the
// tool's result, as `tool_output` (the docs) or `tool_response` (older
// versions), an object or a JSON string. It decides from structure only, never
// from the result's words. The shapes, seen on Claude Code 2.1.283 and named by
// the ruling for 2.1.284:
//
//   to a teammate in this process  { success, message, msg_id, routing: { sender, target, targetColor, summary, content } }
//   to another session             { success, message, display, msg_id }
//
// A result with `routing` is a teammate: nothing to say. A successful one
// without it went to another session, the one `tool_input.to` names; when that
// name, less a trailing ` [xxxxxx]` ref, is none of the session addresses in the
// books of all the bots in this bots folder (retired ones' included), the hook
// warns. A `to` of `uds:` or `bridge:`, a reply to a `from=`, cannot be judged
// against the books, and neither can a send that failed: nothing said.
//
// The warning is Claude Code's PostToolUse context, on standard output:
// `{ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }`,
// exit 0. It says the address is outside this bots folder, names the road
// `obk message to` gives where the `to` starts `<bot>.<session>` and this fleet
// has that bot and session (see "the road it names"), and says to check before
// sending again. It never
// carries a decision (ruling, point 1): no `permissionDecision`, no
// `decision`, no `continue`. Whatever it cannot read, it says nothing and exits
// 0: it never fails a turn.
//
// `obk up` writes it into a Claude bot's `.claude/settings.json` beside the
// SessionStart hook, by the kit's own path, under `PostToolUse` with the matcher
// `SendMessage`; not into Codex's hooks, since Codex has no SendMessage. `obk
// health` names a Claude bot whose settings lack it, or whose send hook runs a
// kit that is not there.
//
// Every run is in the sandbox: its own HOME, a fake Orca.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookOf,
  createSandbox,
  hookFileOf,
  hooksIn,
  kitLaunchMark,
  sessionIn,
  sh,
  spellingsOf,
  tabsOfBot,
} from './helpers/cli.js';

// ---------------------------------------------------------------- the fleet

/**
 * Bot Father, api-bot on Claude Code with daily, and web-bot on Codex with
 * daily, all brought up, so that each Claude session's book holds the address
 * the kit gave it.
 */
async function fleet(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  for (const [bot, harness] of [['api-bot', 'claude'], ['web-bot', 'codex']]) {
    await ok(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    await ok(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
    await ok(['up', '--bots', 'bots', '--bot', bot]);
  }
  const bots = box.path('bots');
  const addressOf = async (bot) => {
    const address = (await sessionIn(bots, bot, 'daily'))?.address;
    assert.match(String(address), new RegExp(`^${bot}\\.daily\\.[a-z0-9]{8}$`), `the premise: the kit gave ${bot} daily an address, got: ${address}`);
    return address;
  };
  return { bots, api: await addressOf('api-bot'), father: await addressOf('bot-father') };
}

// ------------------------------------------------- what Claude Code hands the hook

/** A teammate's result, as Claude Code 2.1.283 wrote one: `routing` in it. */
const TEAMMATE = {
  success: true,
  message: 'Message sent to researcher\'s inbox',
  msg_id: 'msg-teammate-1',
  routing: { sender: 'team-lead', target: '@researcher', targetColor: 'red', summary: 'the plan', content: 'Here is the plan.' },
};

/** Another session's result, as Claude Code 2.1.283 wrote one: no `routing`. */
const ANOTHER_SESSION = {
  success: true,
  message: 'Message sent to the session.',
  display: 'Sent to the session',
  msg_id: 'msg-session-1',
};

/** The PostToolUse event after a SendMessage to `to` that answered `result`, under `field`, as an object or a string. */
const sent = (to, result, { field = 'tool_output', asString = false, tool = 'SendMessage' } = {}) => `${JSON.stringify({
  session_id: 'sess-sender',
  transcript_path: '/nowhere',
  cwd: '/nowhere',
  hook_event_name: 'PostToolUse',
  tool_name: tool,
  tool_input: { to, summary: 'the report', message: 'Here is the report.' },
  [field]: asString ? JSON.stringify(result) : result,
})}\n`;

/** Run the hook as Claude Code runs it: `obk session sent` for api-bot, the event on standard input. */
const hook = (box, stdin, bots = 'bots') => box.run(['session', 'sent', '--bots', bots, '--bot', 'api-bot'], { stdin });

/** Every key anywhere in a value. */
const keysIn = (value) => (value !== null && typeof value === 'object'
  ? Object.entries(value).flatMap(([key, held]) => [key, ...keysIn(held)])
  : []);

/** The fields that would make the hook a decision rather than a warning. */
const DECISIONS = ['permissionDecision', 'decision', 'continue', 'permissionDecisionReason', 'stopReason'];

/**
 * The hook warned: exit 0, and standard output Claude Code's PostToolUse
 * context and nothing else, with no decision anywhere in it. Returns the text.
 */
function assertWarned(ran, what) {
  assert.equal(ran.code, 0, `${what}: the hook never fails the turn: ${ran.stderr}`);
  let answer;
  try {
    answer = JSON.parse(ran.stdout);
  } catch (error) {
    return assert.fail(`${what}: the warning is JSON on standard output, got: ${JSON.stringify(ran.stdout)} (${error.message})`);
  }
  assert.equal(answer?.hookSpecificOutput?.hookEventName, 'PostToolUse', `${what}: a PostToolUse answer, got: ${ran.stdout}`);
  const text = answer.hookSpecificOutput.additionalContext;
  assert.equal(typeof text, 'string', `${what}: its words in additionalContext, got: ${ran.stdout}`);
  assert.deepEqual(keysIn(answer).filter((key) => DECISIONS.includes(key)), [], `${what}: a warning, never a decision: ${ran.stdout}`);
  return text;
}

/** The hook said nothing: exit 0, nothing on standard output. */
function assertSilent(ran, what) {
  assert.equal(ran.code, 0, `${what}: the hook never fails the turn: ${ran.stderr}`);
  assert.equal(ran.stdout, '', `${what}: nothing to say, so nothing on standard output`);
}

/** Words that say the address is not one of this bots folder's. */
const OUTSIDE = /outside|not (?:one )?of (?:this|the) (?:bots )?folder|isn't one of|is not one of|none of/i;

// ------------------------------------------------------------- the warning

test('W1 a message to another session at an address in no book of this bots folder is warned about, and never decided on', async (t) => {
  const box = await createSandbox(t);
  await fleet(box);

  const text = assertWarned(await hook(box, sent('someone-else.daily.ab12cd34', ANOTHER_SESSION)), 'an address no bot here has');

  assert.ok(text.includes('someone-else.daily.ab12cd34'), `it names the address it went to: ${text}`);
  assert.match(text, OUTSIDE, `and says it is outside this bots folder: ${text}`);
  assert.match(text, /\bcheck/i, `and to check before sending again: ${text}`);
});

for (const [label, to] of [
  ['the bare name of before #286, with a ref, the #450 case', 'bot-father.daily [f7d95e]'],
  ['the bare name of before #286', 'bot-father.daily'],
  ['a tokened name that is not the one the book holds', 'bot-father.daily.zz99zz99'],
]) {
  test(`W2 a message to ${label} names the address obk message to gives for that bot and session`, async (t) => {
    const box = await createSandbox(t);
    const { father } = await fleet(box);

    const text = assertWarned(await hook(box, sent(to, ANOTHER_SESSION)), label);

    assert.ok(text.includes(father), `it names the fleet's own address for bot-father daily, ${father}: ${text}`);
    assert.match(text, OUTSIDE, `and says ${to} is outside this bots folder: ${text}`);
  });
}

for (const field of ['tool_output', 'tool_response']) {
  for (const asString of [false, true]) {
    test(`W3 the result is read under ${field}, as ${asString ? 'a JSON string' : 'an object'}: a send outside the books is warned about, a teammate\'s is not`, async (t) => {
      const box = await createSandbox(t);
      await fleet(box);

      assertWarned(await hook(box, sent('someone-else.daily.ab12cd34', ANOTHER_SESSION, { field, asString })), `${field}, ${asString ? 'string' : 'object'}`);
      assertSilent(await hook(box, sent('someone-else.daily.ab12cd34', TEAMMATE, { field, asString })), `a teammate, ${field}`);
    });
  }
}

// ------------------------------------------------------------- nothing to say

test('S1 a message to a teammate in this process is not warned about, whatever its name', async (t) => {
  const box = await createSandbox(t);
  await fleet(box);

  assertSilent(await hook(box, sent('researcher', TEAMMATE)), 'a teammate');
  assertSilent(await hook(box, sent('someone-else.daily.ab12cd34', TEAMMATE)), 'a teammate with a name like another session\'s');
});

test('S2 a message to an address of this bots folder is not warned about, with or without a ref, another bot\'s and a retired session\'s included', async (t) => {
  const box = await createSandbox(t);
  const { bots, api, father } = await fleet(box);
  // A retired session keeps its entry, address and all, in the book's retired list.
  const file = bookOf(bots, 'api-bot');
  const book = parse(await readFile(file, 'utf8'));
  book.retired = [...(book.retired ?? []), { name: 'old', address: 'api-bot.old.ab12cd34', retired: '2026-10-01T08:00:00.000Z' }];
  await writeFile(file, stringify(book));

  for (const to of [api, `${api} [abc123]`, father, `${father} [f7d95e]`, 'api-bot.old.ab12cd34']) {
    assertSilent(await hook(box, sent(to, ANOTHER_SESSION)), `${to}, an address of this bots folder`);
  }
});

test('S3 a reply to a uds: or bridge: sender, a send that failed, and a tool that is not SendMessage are not warned about', async (t) => {
  const box = await createSandbox(t);
  await fleet(box);

  assertSilent(await hook(box, sent('uds:/tmp/cc-socks/4242.sock', ANOTHER_SESSION)), 'a uds: reply');
  assertSilent(await hook(box, sent('bridge:remote-77', ANOTHER_SESSION)), 'a bridge: reply');
  assertSilent(await hook(box, sent('someone-else.daily.ab12cd34', { success: false, message: 'No session by that name.' })), 'a send that failed');
  assertSilent(await hook(box, sent('someone-else.daily.ab12cd34', ANOTHER_SESSION, { tool: 'Bash' })), 'another tool');
});

for (const [label, stdin] of [
  ['standard input that is not JSON', 'claude: something went wrong\n'],
  ['an empty event', '{}\n'],
  ['a SendMessage with no tool_input', `${JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'SendMessage', tool_output: ANOTHER_SESSION })}\n`],
  ['a result that is a string that is not JSON', sent('someone-else.daily.ab12cd34', ANOTHER_SESSION).replace(/"tool_output":\{[^}]*\}/, '"tool_output":"sent, probably"')],
  ['no standard input at all', ''],
]) {
  test(`S4 ${label}: nothing said, exit 0`, async (t) => {
    const box = await createSandbox(t);
    await fleet(box);

    assertSilent(await hook(box, stdin), label);
  });
}

test('S4 a bots folder that is not there, and a book that cannot be read: nothing said, exit 0', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box);
  const outside = sent('someone-else.daily.ab12cd34', ANOTHER_SESSION);

  assertSilent(await hook(box, outside, 'no-such-bots-folder'), 'a bots folder that is not there');
  await writeFile(bookOf(bots, 'web-bot'), 'sessions: [this is: not: a book\n');
  assertSilent(await hook(box, outside), 'a book that cannot be read, so the fleet\'s addresses are not all known');
});

// ------------------------------------------------------------- where up puts it

/** The PostToolUse groups of a parsed Claude settings file whose matcher is SendMessage. */
const sendMessageGroups = (settings) => (settings?.hooks?.PostToolUse ?? []).filter((group) => group?.matcher === 'SendMessage');

/** The commands of those groups that run the kit's `session sent`. */
const sentCommands = (settings) => sendMessageGroups(settings).flatMap((group) => (group.hooks ?? []).map((one) => one.command)).filter((command) => /\bsession sent\b/.test(String(command)));

test('I1 up writes the PostToolUse SendMessage hook into a Claude bot\'s settings, by the kit\'s own path, beside SessionStart, and none into Codex\'s', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box);

  const claude = await hooksIn(bots, 'api-bot', 'claude');
  const commands = sentCommands(claude);
  assert.equal(commands.length, 1, `one kit command under PostToolUse, matcher SendMessage, got: ${JSON.stringify(claude?.hooks)}`);
  const [command] = commands;
  assert.ok(spellingsOf(box.cli).some((cli) => command.includes(`${cli} session sent`)), `run by the kit's own path, ${box.cli}: ${command}`);
  assert.ok(spellingsOf(bots).some((spelling) => command.includes(spelling)), `for this bots folder: ${command}`);
  assert.match(command, /--bot\s+'?api-bot\b/, `and this bot: ${command}`);
  assert.ok(Array.isArray(claude.hooks.SessionStart) && claude.hooks.SessionStart.length > 0, 'beside the SessionStart hook, which stays');
  const codex = await hooksIn(bots, 'web-bot', 'codex');
  assert.ok(codex !== undefined, 'the premise: the Codex bot has its hooks file');
  // Codex does get a PostToolUse hook of the kit's, on Bash (#350): not this one.
  assert.ok(!JSON.stringify(codex).includes('session sent') && sendMessageGroups(codex).length === 0, `Codex has no SendMessage, so nothing of it there: ${JSON.stringify(codex)}`);
});

test('I1 the installed hook, run as Claude Code runs it, warns about a send outside the books and says nothing about one inside', async (t) => {
  const box = await createSandbox(t);
  const { bots, api } = await fleet(box);
  const [command] = sentCommands(await hooksIn(bots, 'api-bot', 'claude'));
  assert.equal(typeof command, 'string', 'the premise: up wrote the kit\'s SendMessage hook');

  assertWarned(await sh(command, { cwd: box.cwd, env: box.env, stdin: sent('someone-else.daily.ab12cd34', ANOTHER_SESSION) }), 'the installed line, outside');
  assertSilent(await sh(command, { cwd: box.cwd, env: box.env, stdin: sent(api, ANOTHER_SESSION) }), 'the installed line, inside');
});

test('I2 a second up writes nothing new, and the user\'s own PostToolUse entries and settings stay as they were', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box);
  const file = hookFileOf(bots, 'api-bot', 'claude');
  const settings = JSON.parse(await readFile(file, 'utf8'));
  const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo my own after Bash' }] };
  const mineOnSend = { matcher: 'SendMessage', hooks: [{ type: 'command', command: 'echo my own after SendMessage' }] };
  settings.hooks.PostToolUse = [mine, ...(settings.hooks.PostToolUse ?? []), mineOnSend];
  // The user's own rule after the ones the kit wrote: since #527 the kit's
  // default rules are in the file already, and a second up has nothing to add.
  settings.permissions = { ...settings.permissions, allow: [...(settings.permissions?.allow ?? []), 'Bash(echo:*)'] };
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
  const before = await readFile(file, 'utf8');

  const again = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(again.code, 0, again.stderr);

  assert.equal(await readFile(file, 'utf8'), before, 'nothing to add, so nothing written: the user\'s entries where they put them');
  assert.equal(sentCommands(JSON.parse(before)).length, 1, 'still one kit command for SendMessage');
});

test('I2 a Claude bot whose settings lost the SendMessage hook gets it back from up, and the user\'s own entries stay', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box);
  const file = hookFileOf(bots, 'api-bot', 'claude');
  const settings = JSON.parse(await readFile(file, 'utf8'));
  const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo my own after Bash' }] };
  settings.hooks.PostToolUse = [mine];
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);

  const again = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(again.code, 0, again.stderr);

  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(sentCommands(after).length, 1, `the kit's SendMessage hook is back: ${JSON.stringify(after.hooks)}`);
  assert.ok(after.hooks.PostToolUse.some((group) => JSON.stringify(group) === JSON.stringify(mine)), `and the user's own Bash entry is still there: ${JSON.stringify(after.hooks.PostToolUse)}`);
});

// ------------------------------------------------------------- health

/** `obk health --json`. */
async function health(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  assert.equal(result.stderr, '', result.stderr);
  return { code: result.code, answer: JSON.parse(result.stdout) };
}

test('H1 health names a Claude bot whose settings lack the SendMessage hook, and says nothing of one that has it', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box);
  const file = hookFileOf(bots, 'api-bot', 'claude');

  const whole = await health(box);
  assert.deepEqual(whole.answer.found.filter((one) => `${one.where} ${one.says}`.includes(file)), [], `the hook is there, so nothing about ${file}: ${JSON.stringify(whole.answer.found)}`);

  const settings = JSON.parse(await readFile(file, 'utf8'));
  delete settings.hooks.PostToolUse;
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);

  const { code, answer } = await health(box);
  const about = answer.found.filter((one) => `${one.where} ${one.says}`.includes(file));
  assert.equal(about.length, 1, `one finding names ${file}, whose SendMessage hook is gone: ${JSON.stringify(answer.found, null, 2)}`);
  assert.match(about[0].says, /SendMessage|PostToolUse/, `and says which hook: ${about[0].says}`);
  assert.equal(code, 1, 'a finding exits 1');
});

// ------------------------------------------------------------- the road it names

// The road the warning names is the one `obk message to` gives from the sender's
// own session (PRD 6.9, #451 review): native to the receiver's address only
// between Claude sessions of one approval class, and otherwise the receiver's
// `run:` mailbox, by `obk message send`. The sender is told by its tab, as a
// command run inside a kit-launched session is. With no tab to tell it by, the
// warning names the session's address and the `obk message to` question, and
// claims nothing more.

/**
 * Bot Father; api-bot, the sender, and peer-bot, both Claude at approval auto
 * (prompting); and skip-bot, Claude at dangerously-skip (bypassing). Each has a
 * daily session, brought up, so each has an address, a mailbox and a tab.
 */
async function classes(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  for (const [bot, approval] of [['api-bot', 'auto'], ['peer-bot', 'auto'], ['skip-bot', 'dangerously-skip']]) {
    await ok(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', 'claude']);
    // The approval is set by `obk permission approval` since #527.
    await ok(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
    await ok(['permission', 'approval', '--bots', 'bots', '--bot', bot, '--session', 'daily', '--approval', approval]);
    await ok(['up', '--bots', 'bots', '--bot', bot]);
  }
  const bots = box.path('bots');
  const entry = async (bot) => {
    const held = await sessionIn(bots, bot, 'daily');
    assert.match(String(held?.address), new RegExp(`^${bot}\\.daily\\.[a-z0-9]{8}$`), `the premise: ${bot} daily has its address, got: ${JSON.stringify(held)}`);
    assert.equal(typeof held?.mailbox, 'string', `the premise: ${bot} daily has its mailbox, got: ${JSON.stringify(held)}`);
    return held;
  };
  return { bots, peer: await entry('peer-bot'), skip: await entry('skip-bot') };
}

/** The environment of a command run inside api-bot daily's own tab, as the kit launched it. */
async function senderTab(box, bots) {
  const wanted = (await sessionIn(bots, 'api-bot', 'daily'))?.tab;
  const terminal = (await tabsOfBot(box, bots, 'api-bot')).find((one) => one.tabId === wanted);
  assert.ok(terminal, `the premise: api-bot daily has its tab ${wanted}`);
  return { ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) };
}

/** What `obk message to` answers for api-bot daily writing to `bot` daily. */
async function roadFromSender(box, bot) {
  const asked = await box.run(['message', 'to', '--bots', 'bots', '--from', 'api-bot/daily', '--to', `${bot}/daily`, '--json']);
  assert.equal(asked.code, 0, asked.stderr);
  return JSON.parse(asked.stdout);
}

test('R1 run in the sender\'s tab, a receiver in its own approval class: the warning names the native address', async (t) => {
  const box = await createSandbox(t);
  const { bots, peer } = await classes(box);
  assert.deepEqual(
    (({ transport, address }) => ({ transport, address }))(await roadFromSender(box, 'peer-bot')),
    { transport: 'native', address: peer.address },
    'the premise: obk message to gives the native road between two auto Claude sessions',
  );

  const ran = await box.run(['session', 'sent', '--bots', 'bots', '--bot', 'api-bot'], { stdin: sent('peer-bot.daily', ANOTHER_SESSION), env: await senderTab(box, bots) });
  const text = assertWarned(ran, 'the bare name of a session in the sender\'s class');

  assert.ok(text.includes(peer.address), `it names peer-bot daily's address, ${peer.address}, the native road: ${text}`);
  assert.ok(!text.includes(`run:${peer.mailbox}`), `and not its mailbox, which is not the road between these two: ${text}`);
});

test('R2 run in the sender\'s tab, a receiver in another approval class: the warning names the run: mailbox and obk message send, and not the native address', async (t) => {
  const box = await createSandbox(t);
  const { bots, skip } = await classes(box);
  assert.deepEqual(
    (({ transport, address }) => ({ transport, address }))(await roadFromSender(box, 'skip-bot')),
    { transport: 'orca', address: `run:${skip.mailbox}` },
    'the premise: obk message to gives the Orca road from an auto sender to a dangerously-skip receiver',
  );

  const ran = await box.run(['session', 'sent', '--bots', 'bots', '--bot', 'api-bot'], { stdin: sent('skip-bot.daily [ab12cd]', ANOTHER_SESSION), env: await senderTab(box, bots) });
  const text = assertWarned(ran, 'the bare name of a session in another class');

  assert.ok(text.includes(`run:${skip.mailbox}`), `it names skip-bot daily's mailbox, run:${skip.mailbox}, the road obk message to gives: ${text}`);
  assert.match(text, /\bmessage send\b/, `and that the road is obk message send: ${text}`);
  assert.ok(!text.includes(skip.address), `and not skip-bot daily's native address, ${skip.address}, which is not the road from this sender: ${text}`);
});

test('R3 with no tab to tell the sender by, the warning names the session\'s address and the obk message to command for it', async (t) => {
  const box = await createSandbox(t);
  const { skip } = await classes(box);

  const text = assertWarned(await hook(box, sent('skip-bot.daily', ANOTHER_SESSION)), 'no tab');

  assert.ok(text.includes(skip.address), `it names skip-bot daily's address, ${skip.address}: ${text}`);
  assert.match(text, /\bmessage to --bots \S+ --to skip-bot\/daily\b/, `and the obk message to command that gives the road to it: ${text}`);
});

test('H2 health names a Claude bot whose send hook runs a kit that is not there, with SessionStart intact, and exits 1', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box);
  const file = hookFileOf(bots, 'api-bot', 'claude');
  const settings = JSON.parse(await readFile(file, 'utf8'));
  const sessionStart = JSON.stringify(settings.hooks.SessionStart);
  // Named obk, as an installed kit is, so the line is still the kit's; the folder is not there.
  const gone = box.path('kit-moved-away/bin/obk');
  let replaced = 0;
  for (const group of sendMessageGroups(settings)) {
    for (const one of group.hooks ?? []) {
      const spelling = spellingsOf(box.cli).find((cli) => String(one.command).startsWith(`${cli} session sent `));
      if (spelling === undefined) continue;
      one.command = `${gone}${one.command.slice(spelling.length)}`;
      replaced += 1;
    }
  }
  assert.equal(replaced, 1, `the premise: one kit send hook, run by ${box.cli}, to point elsewhere: ${JSON.stringify(settings.hooks)}`);
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
  assert.equal(JSON.stringify(JSON.parse(await readFile(file, 'utf8')).hooks.SessionStart), sessionStart, 'the premise: SessionStart as up wrote it');

  const { code, answer } = await health(box);
  const about = answer.found.filter((one) => `${one.where} ${one.says}`.includes(file));
  assert.equal(about.length, 1, `one finding names ${file}, whose send hook runs ${gone}: ${JSON.stringify(answer.found, null, 2)}`);
  assert.match(about[0].says, /SendMessage|PostToolUse|send hook/, `and says it is the send hook: ${about[0].says}`);
  assert.equal(code, 1, 'a finding exits 1');
});
