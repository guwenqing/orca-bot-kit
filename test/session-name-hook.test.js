// The kit's async Codex `Stop` hook that names a session's thread (#480), and
// where `obk up` and `obk health` deal with it.
//
// A Codex session's tab shows its thread's name, and Codex 0.160.0 has no
// launch-time way to set one. So, by the architect's ruling on #480
// (2026-10-04), the kit adds an async Codex `Stop` hook: at each turn end it
// runs `obk session name`, which names the thread `<bot>.<session>`
// (session-name.test.js holds what that command does). What these tests hold:
//
//   - A Codex bot's `.codex/hooks.json` holds, under `Stop`, in a group with
//     no `matcher`, exactly one kit entry:
//       { "type": "command",
//         "command": "<kit cli> session name --bots <bots> --bot <bot> 2>/dev/null || true",
//         "timeout": 300, "async": true }
//     the command quoted the way the kit's other hook commands are. `async`
//     makes Codex run it in the background without holding the turn.
//   - The rules every kit hook entry keeps: a second run adds nothing; an
//     entry with an old bots path or an old kit path is rewritten in place,
//     not doubled; the user's own entries and groups stay; a kit entry under
//     another event is taken out.
//   - A Claude Code bot gets no such entry.
//   - `obk health` names a Codex bot whose hooks file lacks the entry, and
//     says `obk up` puts it back; and one whose entry runs a kit CLI path that
//     is no longer there, as it does for the nudge hook.
//
// The cost the ruling names, Codex's "Hooks need review" coming up once more
// in each existing Codex bot, is a release note, not a test.
//
// Every run is in the sandbox: its own HOME, a fake Orca (helpers/cli.js).

import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  eventsIn,
  hookFileOf,
  hooksIn,
  kitHooksIn,
  recordSession,
  sessionIn,
  shellWord,
  spellingsOf,
  tabsOfBot,
  throughAHarness,
} from './helpers/cli.js';
import { CODEX_ANSWERED, CODEX_IDLE, CODEX_SLASH_TYPED } from './helpers/screens.js';

/** The Codex bot, and a Claude Code bot beside it. */
const CODEX_BOT = 'api-bot';
const CLAUDE_BOT = 'web-bot';

// ------------------------------------------------------------- the fleet

/** Both bots, each with a `daily` session, all up. */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [[CODEX_BOT, 'codex'], [CLAUDE_BOT, 'claude']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** `obk up` for the Codex bot, which has to go through. */
async function upAgain(box) {
  const again = await box.run(['up', '--bots', 'bots', '--bot', CODEX_BOT]);
  assert.equal(again.code, 0, again.stderr);
}

// ------------------------------------------------------------- the entry

/** Whether a hook entry runs the kit's `session name`. */
const runsName = (entry) => /\bsession name\b/.test(String(entry?.command));

/** Every entry under `event`, in any group, that runs the kit's `session name`. */
const nameEntriesUnder = (held, event) => (eventsIn(held)?.[event] ?? [])
  .flatMap((group) => group?.hooks ?? [])
  .filter(runsName);

/** Every entry under any event that runs the kit's `session name`, as `[event, entry]`. */
const nameEntriesAnywhere = (held) => Object.entries(eventsIn(held) ?? {})
  .flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [])
    .flatMap((group) => group?.hooks ?? [])
    .filter(runsName)
    .map((entry) => [event, entry]));

/** The kit's naming line for `bot`, in each spelling of the kit's path it may use: the form of its other hook lines. */
const nameHookLines = (box, bots, bot = CODEX_BOT) => spellingsOf(box.cli).map(
  (cli) => `${cli} session name --bots ${shellWord(bots)} --bot ${shellWord(bot)} 2>/dev/null || true`,
);

/** A hook of the user's own at Codex's turn end, to sit beside the kit's and be left alone. */
const THEIRS = { type: 'command', command: 'echo mine at the turn end' };

test('up writes the kit\'s naming hook into a Codex bot\'s .codex/hooks.json: under Stop, in a group with no matcher, once, async, with a 300 s timeout', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const held = await hooksIn(bots, CODEX_BOT, 'codex');

  assert.ok(held !== undefined, 'the premise: the Codex bot has its hooks file');
  const text = JSON.stringify(eventsIn(held));
  const groups = (eventsIn(held).Stop ?? []).filter((group) => (group?.hooks ?? []).some(runsName));
  assert.equal(groups.length, 1, `one Stop group holds the kit's entry: ${text}`);
  assert.equal('matcher' in groups[0], false, `a group with no matcher: ${JSON.stringify(groups[0])}`);
  const [entry, ...more] = groups[0].hooks.filter(runsName);
  assert.deepEqual(more, [], `one kit entry in it: ${JSON.stringify(groups[0])}`);
  assert.ok(nameHookLines(box, bots).includes(entry.command), `the kit's line, one of ${JSON.stringify(nameHookLines(box, bots))}, got: ${entry.command}`);
  assert.deepEqual(entry, { type: 'command', command: entry.command, timeout: 300, async: true }, 'a command entry, 300 s, run in the background, and nothing else');
  assert.deepEqual(nameEntriesAnywhere(held).map(([event]) => event), ['Stop'], `and no naming entry under any other event: ${text}`);
  assert.equal(kitHooksIn(held).length, 1, 'beside the kit\'s SessionStart entry, which stays');
});

test('the installed line, run as Codex runs it at a turn end in the session\'s tab, types /rename <bot>.<session> and its return into that tab', async (t) => {
  // The screens are those of session-name.test.js, as few as this needs:
  // reconstructions on helpers/screens.js's captures.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const [entry] = nameEntriesUnder(await hooksIn(bots, CODEX_BOT, 'codex'), 'Stop');
  assert.equal(typeof entry?.command, 'string', 'the premise: up wrote the kit\'s naming hook');
  const { tab: tabId } = await sessionIn(bots, CODEX_BOT, 'daily');
  const tab = (await tabsOfBot(box, bots, CODEX_BOT)).find((one) => one.tabId === tabId);
  assert.ok(tab, `the premise: Orca has the session's tab ${tabId}`);
  const thread = '0199c0de-4800-7000-8000-00000000da11';
  const heard = await recordSession(box, { bots, bot: CODEX_BOT, tab: tabId, session: thread });
  assert.equal(heard.code, 0, `the premise: the book holds the conversation: ${heard.stderr}`);
  await conversationOnRecord(box, { harness: 'codex', cwd: botHomeOf(bots, CODEX_BOT), id: thread, cliVersion: '0.160.0' });

  const name = `${CODEX_BOT}.daily`;
  const command = `/rename ${name}`;
  const above = CODEX_ANSWERED.slice(0, 12);
  const status = '  GPT-6-Luna medium · /private/var/folders/…/bots/api-b…';
  const screens = [...command].slice(0, -1).map((_, at) => {
    const sofar = command.slice(0, at + 1);
    if (sofar === '/') return CODEX_SLASH_TYPED;
    if (!sofar.includes(' ')) return [...CODEX_ANSWERED.slice(0, 11), '› /rename  rename the current thread', '', '›', status];
    return [...above, `› ${sofar}`, status];
  });
  const state = await box.orca.terminals();
  await box.orca.set({ terminals: state.map((one) => (one.tabId === tabId ? { ...one, nextScreens: [...screens, [...above, `› ${command}`, status], CODEX_IDLE] } : one)) });

  // Codex, played: once the return is in, its `/rename` writes the name.
  const index = path.join(box.home, '.codex', 'session_index.jsonl');
  let stopped = false;
  const play = (async () => {
    let wrote = false;
    while (!stopped) {
      const typed = ((await box.orca.terminals()).find((one) => one.tabId === tabId)?.typed ?? []).slice(1);
      if (!wrote && typed.some((one) => one.text === '\r')) {
        await mkdir(path.dirname(index), { recursive: true });
        await appendFile(index, `${JSON.stringify({ id: thread, thread_name: name, updated_at: new Date().toISOString() })}\n`);
        wrote = true;
      }
      await sleep(50);
    }
  })();
  const stdin = `${JSON.stringify({
    session_id: thread, turn_id: 'turn-1', transcript_path: '/nowhere/rollout.jsonl', cwd: botHomeOf(bots, CODEX_BOT),
    hook_event_name: 'Stop', model: 'gpt-5.5', permission_mode: 'default', stop_hook_active: false, last_assistant_message: 'OK',
  })}\n`;

  const ran = await throughAHarness(box, entry.command, { tab: tabId, env: { ...box.env, OBK_CLI: box.cli, ORCA_TERMINAL_HANDLE: tab.handle }, stdin });
  stopped = true;
  await play;

  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout, '', 'nothing on stdout: no decision for Codex');
  const sends = ((await box.orca.terminals()).find((one) => one.tabId === tabId)?.typed ?? []).slice(1).map(({ text, enter }) => ({ text, enter }));
  assert.deepEqual(sends, [...[...command].map((text) => ({ text, enter: false })), { text: '\r', enter: false }], 'the command a character a send, then its return');
});

test('a second up writes nothing new to the Codex hooks file', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, CODEX_BOT, 'codex');
  const before = await readFile(file, 'utf8');
  assert.equal(nameEntriesUnder(JSON.parse(before), 'Stop').length, 1, 'the premise: the first up wrote the naming hook');

  await upAgain(box);

  assert.equal(await readFile(file, 'utf8'), before, 'nothing to add, so nothing written');
});

test('a Codex hooks file that lost the naming hook gets it back from up, and the user\'s own Stop groups and entries stay', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, CODEX_BOT, 'codex');
  const held = JSON.parse(await readFile(file, 'utf8'));
  const mine = { hooks: [THEIRS] };
  const mineTimed = { hooks: [{ type: 'command', command: 'echo mine, slower', timeout: 5 }] };
  eventsIn(held).Stop = [mine, mineTimed];
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

  await upAgain(box);

  const after = JSON.parse(await readFile(file, 'utf8'));
  const text = JSON.stringify(eventsIn(after).Stop);
  const back = nameEntriesUnder(after, 'Stop');
  assert.equal(back.length, 1, `the kit's naming hook is back, once: ${text}`);
  assert.ok(nameHookLines(box, bots).includes(back[0].command), `in the kit's form: ${text}`);
  assert.deepEqual(back[0], { type: 'command', command: back[0].command, timeout: 300, async: true }, `async, 300 s: ${text}`);
  for (const group of [mine, mineTimed]) {
    assert.ok(
      eventsIn(after).Stop.some((one) => one.hooks.some((entry) => JSON.stringify(entry) === JSON.stringify(group.hooks[0]))),
      `the user's own Stop entry ${group.hooks[0].command} is still there, as they wrote it: ${text}`,
    );
  }
  assert.equal(kitHooksIn(after).length, 1, 'and the kit\'s SessionStart entry with them');
});

test('a user\'s entry in the kit\'s own Stop group survives a second up, and the file is left as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, CODEX_BOT, 'codex');
  const held = JSON.parse(await readFile(file, 'utf8'));
  const [group] = (eventsIn(held).Stop ?? []).filter((one) => (one.hooks ?? []).some(runsName));
  assert.ok(group, `the premise: the kit's Stop group, got: ${JSON.stringify(eventsIn(held))}`);
  group.hooks.push(THEIRS);
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
  const before = await readFile(file, 'utf8');

  await upAgain(box);

  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), JSON.parse(before), 'nothing in the file is the kit\'s to change');
});

test('the kit\'s naming entry written for a bots folder that moved is rewritten in place, not doubled, and the user\'s entry beside it stays', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, CODEX_BOT, 'codex');
  const held = JSON.parse(await readFile(file, 'utf8'));
  const [kit] = nameEntriesUnder(held, 'Stop');
  assert.ok(kit?.command?.includes(` --bots ${shellWord(bots)} `), `the premise: the kit's line names ${bots}, got: ${JSON.stringify(kit)}`);
  const old = kit.command.replace(` --bots ${shellWord(bots)} `, " --bots '/old place/bots' ");
  eventsIn(held).Stop = [{ hooks: [{ ...kit, command: old }, THEIRS] }];
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

  await upAgain(box);

  const after = JSON.parse(await readFile(file, 'utf8'));
  const text = JSON.stringify(eventsIn(after).Stop);
  assert.equal(eventsIn(after).Stop.length, 1, `one Stop group, the one that was there: ${text}`);
  const [only] = eventsIn(after).Stop;
  assert.deepEqual(
    only.hooks.map((one) => one.command).sort(),
    [nameEntriesUnder(after, 'Stop')[0]?.command, THEIRS.command].sort(),
    `the kit's entry and the user's, and nothing else: ${text}`,
  );
  assert.ok(nameHookLines(box, bots).includes(nameEntriesUnder(after, 'Stop')[0]?.command), `the old line is today's now: ${text}`);
  assert.ok(!text.includes('/old place/bots'), `and the old path is gone: ${text}`);
});

test('the kit\'s naming entry that runs a kit no longer there is rewritten in place to run this one, not doubled', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, CODEX_BOT, 'codex');
  const held = JSON.parse(await readFile(file, 'utf8'));
  const [kit] = nameEntriesUnder(held, 'Stop');
  const spelling = spellingsOf(box.cli).find((cli) => String(kit?.command).startsWith(`${cli} session name `));
  assert.ok(spelling !== undefined, `the premise: the kit's line runs ${box.cli}, got: ${JSON.stringify(kit)}`);
  // Named obk, as an installed kit is, so the line is still the kit's; the folder is not there.
  const gone = box.path('kit-moved-away/bin/obk');
  eventsIn(held).Stop = [{ hooks: [{ ...kit, command: `${gone}${kit.command.slice(spelling.length)}` }] }];
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

  await upAgain(box);

  const after = JSON.parse(await readFile(file, 'utf8'));
  const text = JSON.stringify(eventsIn(after).Stop);
  const now = nameEntriesUnder(after, 'Stop');
  assert.equal(now.length, 1, `one naming entry: ${text}`);
  assert.ok(nameHookLines(box, bots).includes(now[0].command), `running the kit there is now: ${text}`);
  assert.ok(!text.includes(gone), `and the old kit is gone from the file: ${text}`);
});

for (const event of ['PostToolUse', 'SessionStart', 'UserPromptSubmit']) {
  test(`a kit naming entry under ${event} is taken out, and the one under Stop stays`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const file = hookFileOf(bots, CODEX_BOT, 'codex');
    const held = JSON.parse(await readFile(file, 'utf8'));
    const [kit] = nameEntriesUnder(held, 'Stop');
    assert.ok(kit, `the premise: the kit's Stop entry, got: ${JSON.stringify(eventsIn(held))}`);
    eventsIn(held)[event] = [...(eventsIn(held)[event] ?? []), { hooks: [structuredClone(kit)] }];
    await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
    assert.equal(nameEntriesUnder(held, event).length, 1, `the premise: a naming entry planted under ${event}`);

    await upAgain(box);

    const after = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(nameEntriesAnywhere(after).map(([where]) => where), ['Stop'], `one naming entry, under Stop: ${JSON.stringify(eventsIn(after))}`);
    assert.equal(kitHooksIn(after).length, 1, 'and the kit\'s SessionStart entry stays');
  });
}

test('a Claude Code bot\'s settings get no naming hook', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const claude = await hooksIn(bots, CLAUDE_BOT, 'claude');
  const codex = await hooksIn(bots, CODEX_BOT, 'codex');

  assert.ok(claude !== undefined, 'the premise: the Claude bot has its settings file');
  assert.equal(nameEntriesUnder(codex, 'Stop').length, 1, 'the premise: the Codex bot beside it has the naming hook');
  // #527: permissions.allow holds the default rule for `session name`, a rule
  // and not a hook; the point here is that no hook entry runs it.
  assert.ok(!JSON.stringify(claude.hooks ?? {}).includes('session name'), `nothing of it in Claude's hooks: ${JSON.stringify(claude.hooks)}`);
});

// ------------------------------------------------------------- health

/** `obk health --json`. */
async function health(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  assert.equal(result.stderr, '', result.stderr);
  return { code: result.code, answer: JSON.parse(result.stdout) };
}

/** The findings that name `file`. */
const about = (answer, file) => answer.found.filter((one) => `${one.where} ${one.says}`.includes(file));

test('health names a Codex bot whose hooks file lacks the naming hook, says obk up puts it back, and exits 1; it says nothing of one that has it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, CODEX_BOT, 'codex');

  const whole = await health(box);
  assert.deepEqual(about(whole.answer, file), [], `the hook is there, so nothing about ${file}: ${JSON.stringify(whole.answer.found)}`);

  const held = JSON.parse(await readFile(file, 'utf8'));
  eventsIn(held).Stop = (eventsIn(held).Stop ?? [])
    .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((entry) => !runsName(entry)) }))
    .filter((group) => group.hooks.length > 0);
  if (eventsIn(held).Stop.length === 0) delete eventsIn(held).Stop;
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
  assert.equal(kitHooksIn(held).length, 1, 'the premise: the SessionStart entry is as up wrote it');

  const { code, answer } = await health(box);
  const found = about(answer, file);
  assert.equal(found.length, 1, `one finding names ${file}, whose naming hook is gone: ${JSON.stringify(answer.found, null, 2)}`);
  assert.match(found[0].says, /\bStop\b|session name/, `and says which hook: ${found[0].says}`);
  assert.match(found[0].says, /\bobk up\b/, `and that obk up puts it back: ${found[0].says}`);
  assert.equal(code, 1, 'a finding exits 1');
});

test('health names a Codex bot whose naming hook runs a kit that is not there, with SessionStart intact, and exits 1', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, CODEX_BOT, 'codex');
  const held = JSON.parse(await readFile(file, 'utf8'));
  const sessionStart = JSON.stringify(eventsIn(held).SessionStart);
  // Named obk, as an installed kit is, so the line is still the kit's; the folder is not there.
  const gone = box.path('kit-moved-away/bin/obk');
  let replaced = 0;
  for (const one of nameEntriesUnder(held, 'Stop')) {
    const spelling = spellingsOf(box.cli).find((cli) => String(one.command).startsWith(`${cli} session name `));
    if (spelling === undefined) continue;
    one.command = `${gone}${one.command.slice(spelling.length)}`;
    replaced += 1;
  }
  assert.equal(replaced, 1, `the premise: one kit naming hook, run by ${box.cli}, to point elsewhere: ${JSON.stringify(eventsIn(held))}`);
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
  assert.equal(JSON.stringify(eventsIn(JSON.parse(await readFile(file, 'utf8'))).SessionStart), sessionStart, 'the premise: SessionStart as up wrote it');

  const { code, answer } = await health(box);
  const found = about(answer, file);
  assert.equal(found.length, 1, `one finding names ${file}, whose naming hook runs ${gone}: ${JSON.stringify(answer.found, null, 2)}`);
  assert.match(found[0].says, /\bStop\b|session name/, `and says it is the naming hook: ${found[0].says}`);
  assert.equal(code, 1, 'a finding exits 1');
});
