// The kit calls itself by its own path (#220).
//
// Wherever the kit writes or types a command that runs the kit again — the
// session hook in a bot's folder, the launch line typed into a tab, the line
// that tells a tab mail is waiting, the command `obk message to` hands back —
// that command names the CLI that is running, by the path it was started by,
// and never the bare word `obk`.
//
// Why: the bare word is whatever PATH finds, and on the owner's machine that is
// the published release. A system test that ran this checkout's `src/cli.js`
// made a fleet whose hooks and bots ran the release instead, and the only lever
// left was switching the machine's one global `obk`, which is what broke the
// owner's own fleet. PATH cannot be made to carry it either: Codex's shell reads
// the user's startup files again and puts the machine's `obk` back in front
// (measured, #220). A variable set on the launch line does survive, which is
// why the line carries `OBK_CLI`.
//
// "The path it was started by" is the path as given, made absolute, with any
// link in it kept: through npm's bin link it is the link, not the file under
// node_modules the link leads to, because the link is what stays put when npm
// or Node moves the install. In a sandbox that is `<root>/bin/obk` (`box.cli`),
// the link to this checkout's `src/cli.js`.
//
// Most tests here put a decoy `obk` first on PATH: a program that notes it was
// run and does nothing else. A command that reached for the bare word would
// find the decoy, and the effect the test waits for would not happen.
//
// A bot's AGENTS.md is the exception, and on purpose: it is versioned and the
// same on every machine, so it names no install path at all. It tells the bot
// to run `"${OBK_CLI:-obk}"`, which is the launch line's variable in a tab the
// kit started and the machine's `obk` anywhere else.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  cliEntry,
  cliOnLine,
  createSandbox,
  fakeProgram,
  hookFileOf,
  hooksIn,
  eventsIn,
  kitHooksIn,
  node,
  plainCli,
  sessionIn,
  sh,
  shellWord,
  spellingsOf,
  tabsOfBot,
  throughAHarness,
  typedInto,
} from './helpers/cli.js';
import { agentsIn } from './helpers/rules.js';

/**
 * A decoy `obk` first on PATH, in a folder of its own: it writes down that it
 * was run and exits 0 having done nothing. Never written into the sandbox's
 * `bin`, where `obk` is a link to this checkout's CLI and writing through it
 * would overwrite `src/cli.js`.
 */
async function decoy(box) {
  const dir = path.join(box.root, 'decoy');
  const log = path.join(box.root, 'decoy.log');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'obk'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${shellWord(log)}\nexit 0\n`);
  await chmod(path.join(dir, 'obk'), 0o755);
  return {
    /** The sandbox's environment with the decoy ahead of everything on PATH. */
    env: { ...box.env, PATH: `${dir}${path.delimiter}${box.env.PATH}` },
    /** Every run of the decoy, one line of arguments each. */
    async runs() {
      try {
        return (await readFile(log, 'utf8')).split('\n').filter((line) => line !== '');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}

/**
 * Another way to start this checkout's CLI: a link to it at `<root>/<folder>/obk`.
 * With a space in the folder it is the path a user's install can have and a
 * shell line has to quote.
 */
async function linkedAt(box, folder) {
  const dir = path.join(box.root, folder);
  await mkdir(dir, { recursive: true });
  const cli = path.join(dir, 'obk');
  await symlink(cliEntry, cli);
  return cli;
}

/** Run the kit by `cli` as a shell runs a command: the path, quoted, then the arguments. */
const runBy = (box, cli, args, { env = box.env } = {}) =>
  sh([cli, ...args].map(shellWord).join(' '), { cwd: box.cwd, env });

/**
 * A bots folder with one bot and one `daily` session, written but not brought
 * up: `up` is the step that writes the hook and types the launch line, so the
 * test says which CLI does it.
 */
async function oneBot(box, harness, bot = 'api-bot') {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** The one hook command the kit wrote for a bot and harness. */
async function kitHookOf(bots, bot, harness) {
  const found = kitHooksIn(await hooksIn(bots, bot, harness));
  assert.equal(found.length, 1, `${hookFileOf(bots, bot, harness)} should hold one hook of the kit's, got: ${JSON.stringify(found)}`);
  return found[0];
}

/**
 * Whether a command starts with `cli`, spelled either way the kit may spell it
 * (`spellingsOf`), and then `rest`.
 */
const startsWithCli = (command, cli, rest) => spellingsOf(cli).some((word) => command.startsWith(`${word} ${rest}`));

/**
 * The hook line the kit writes, word for word (#220): the CLI first, spelled
 * the `shellWord` way. Compared with what the kit wrote through `plainCli`, so
 * the CLI may be quoted when it did not need it.
 */
const hookLine = (cli, bots, bot) =>
  `${shellWord(cli)} session record --bots ${shellWord(bots)} --bot ${shellWord(bot)} 2>/dev/null || true`;

/** What a harness hands the hook: a session starting, in the bot's own folder. */
const started = (session) => `{"session_id":"${session}","transcript_path":"/nowhere","cwd":"/nowhere",`
  + '"hook_event_name":"SessionStart","source":"startup"}\n';

// ---------------------------------------------------------------------------
// The session hook
// ---------------------------------------------------------------------------

for (const harness of ['claude', 'codex']) {
  test(`the ${harness} hook names the CLI that wrote it, by the path it was started by`, async (t) => {
    const box = await createSandbox(t);
    const bots = await oneBot(box, harness);

    const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

    assert.equal(up.code, 0, up.stderr);
    // The link in `bin`, not the `src/cli.js` it leads to.
    assert.equal(plainCli(await kitHookOf(bots, 'api-bot', harness)), hookLine(box.cli, bots, 'api-bot'));
  });

  test(`the ${harness} hook runs the CLI that wrote it, and not the obk PATH finds`, async (t) => {
    // The failure #220 is about, end to end: a hook that says `obk` is run by
    // whatever `obk` the machine has, and a fleet a test made reports to it.
    const box = await createSandbox(t);
    const bots = await oneBot(box, harness);
    assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
    const tab = (await tabsOfBot(box, bots, 'api-bot'))[0];
    const other = await decoy(box);

    const ran = await throughAHarness(box, await kitHookOf(bots, 'api-bot', harness), {
      env: other.env,
      tab: tab.tabId,
      stdin: started('sess-from-the-hook'),
    });

    assert.equal(ran.code, 0, ran.stderr);
    assert.deepEqual(await other.runs(), [], 'the obk on PATH should never have been run');
    assert.equal(
      (await sessionIn(bots, 'api-bot', 'daily')).session,
      'sess-from-the-hook',
      'the CLI that wrote the hook should have recorded the session',
    );
  });
}

test('run by a relative path, the kit names itself by that path made absolute, the link kept', async (t) => {
  // `node ../bin/obk` from the working directory: the path is the link's, made
  // absolute, and not the file the link leads to.
  const box = await createSandbox(t);
  const bots = await oneBot(box, 'claude');

  const up = await node([path.join('..', 'bin', 'obk'), 'up', '--bots', 'bots', '--bot', 'api-bot'], { cwd: box.cwd, env: box.env });

  assert.equal(up.code, 0, up.stderr);
  assert.equal(plainCli(await kitHookOf(bots, 'api-bot', 'claude')), hookLine(box.cli, bots, 'api-bot'));
});

test('run as node <checkout>/src/cli.js, the kit names itself by that file', async (t) => {
  // How a system test runs its checkout: no link anywhere, and the hook it
  // leaves calls back into the same checkout.
  const box = await createSandbox(t);
  const bots = await oneBot(box, 'codex');

  const up = await node([cliEntry, 'up', '--bots', bots, '--bot', 'api-bot'], { cwd: box.cwd, env: box.env });

  assert.equal(up.code, 0, up.stderr);
  assert.equal(plainCli(await kitHookOf(bots, 'api-bot', 'codex')), hookLine(cliEntry, bots, 'api-bot'));
});

test('the kit names itself by its own path, whatever OBK_CLI says in the environment it runs in', async (t) => {
  // A command run inside a bot's tab inherits the OBK_CLI that tab was launched
  // with, which names whichever CLI typed the launch line. A developer running
  // their checkout there by its full path is running the checkout, and what it
  // writes calls back into the checkout.
  const box = await createSandbox(t);
  const bots = await oneBot(box, 'claude');

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'], { env: { ...box.env, OBK_CLI: '/opt/elsewhere/bin/obk' } });

  assert.equal(up.code, 0, up.stderr);
  assert.equal(plainCli(await kitHookOf(bots, 'api-bot', 'claude')), hookLine(box.cli, bots, 'api-bot'));
  const [typed] = typedInto((await tabsOfBot(box, bots, 'api-bot'))[0]);
  assert.ok(typed.includes(` ${cliOnLine(box.cli)} `), `the launch line should name the kit's own path, got: ${typed}`);
});

/** A hook of the user's own, to sit beside the kit's and be left alone. */
const THEIRS = { type: 'command', command: 'echo mine' };

/** Every hook command under one event of a parsed hooks file. */
const commandsUnder = (held, event) => (eventsIn(held)?.[event] ?? []).flatMap((group) => group.hooks ?? []).map((hook) => hook.command);

/**
 * Hook lines the kit wrote before this change, or wrote by another path, for
 * this bot: each is the kit's own and is rewritten in place. `bots` is the
 * bots folder the line names.
 */
const earlierLines = (bots) => ({
  // Every bot folder on a machine today holds this form.
  'the bare obk every earlier kit wrote': `obk session record --bots ${bots} --bot api-bot 2>/dev/null || true`,
  'the bare obk, with the folder quoted': `obk session record --bots '/old place/bots' --bot api-bot 2>/dev/null || true`,
  // An install that moved, or a fleet brought up once by another copy of the
  // kit: still the kit's line, so the next `up` leaves one entry and not two.
  'the kit at another path': `/opt/elsewhere/bin/obk session record --bots ${bots} --bot api-bot 2>/dev/null || true`,
  'the kit at another path with a space in it': `'/old place/bin/obk' session record --bots ${bots} --bot api-bot 2>/dev/null || true`,
});

for (const harness of ['claude', 'codex']) {
  test(`an earlier line of the kit's in the ${harness} hooks file is rewritten in place, beside the user's own`, async (t) => {
    const box = await createSandbox(t);
    const bots = await oneBot(box, harness);
    const file = hookFileOf(bots, 'api-bot', harness);
    await mkdir(path.dirname(file), { recursive: true });

    for (const [label, old] of Object.entries(earlierLines(bots))) {
      const planted = {
        hooks: {
          SessionStart: [{ matcher: 'mine', hooks: [{ type: 'command', command: old, timeout: 10 }, THEIRS] }],
        },
      };
      await writeFile(file, `${JSON.stringify(planted, null, 2)}\n`);

      const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

      assert.equal(up.code, 0, `${label}: ${up.stderr}`);
      const held = await hooksIn(bots, 'api-bot', harness);
      const now = await readFile(file, 'utf8');
      assert.equal(eventsIn(held).SessionStart.length, 1, `${label}: one group, the one that was there, got:\n${now}`);
      assert.equal(eventsIn(held).SessionStart[0].matcher, 'mine', `${label}: and what the user set on it, got:\n${now}`);
      assert.deepEqual(
        commandsUnder(held, 'SessionStart').map(plainCli).sort(),
        [hookLine(box.cli, bots, 'api-bot'), THEIRS.command].sort(),
        `${label}: the old line becomes today's, beside their hook, got:\n${now}`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// The launch line
// ---------------------------------------------------------------------------

for (const harness of ['claude', 'codex']) {
  test(`the ${harness} launch line hands the harness the CLI that typed it, as OBK_CLI`, async (t) => {
    // What every `obk` a bot runs in its tab resolves through: the variable is
    // set on the line itself, so it reaches the harness and the shell the
    // harness runs commands in, whatever PATH that shell ends up with.
    const box = await createSandbox(t);
    const fake = await fakeProgram(box, harness, {});
    const bots = await oneBot(box, harness);
    assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
    // As typed, not as `typedInto` spells it: what runs is what the kit sent.
    const typed = (await tabsOfBot(box, bots, 'api-bot'))[0].typed[0].text;

    const ran = await sh(`${typed}; :`, { cwd: box.cwd, env: box.env });

    assert.equal(ran.code, 0, ran.stderr);
    const calls = await fake.calls();
    assert.equal(calls.length, 1, `the line should start the harness once, got: ${typed}`);
    assert.equal(calls[0].env.OBK_CLI, box.cli, `the harness should be handed the kit's own path, got line: ${typed}`);
  });
}

// ---------------------------------------------------------------------------
// Mail: the nudge and the "Send it:" line
// ---------------------------------------------------------------------------

/**
 * A Claude bot that writes and a Codex bot that reads, both up: every message
 * between them goes by the mailbox. `folder` is the bots folder's name in the
 * sandbox's working directory.
 */
async function mailFleet(box, folder = 'bots') {
  assert.equal((await box.run(['init', '--bots', folder, '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', folder, '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', folder, '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', folder]);
  assert.equal(up.code, 0, up.stderr);
  return box.path(folder);
}

/** The tab one session sits in, which is where a command it runs gets `ORCA_TAB_ID` from. */
const tabOf = async (bots, bot) => (await sessionIn(bots, bot, 'daily')).tab;

/** What the kit typed into the reader's tab after its launch line: the nudge. */
async function nudgeIn(box, bots) {
  const reader = await tabOf(bots, 'coder');
  const lines = typedInto((await box.orca.terminals()).find((terminal) => terminal.tabId === reader)).slice(1);
  assert.equal(lines.length, 1, `one nudge in the reader's tab, got: ${JSON.stringify(lines)}`);
  return lines[0];
}

/** The command a nudge tells the session to run: everything after "Read it with". */
function readCommandIn(nudge) {
  const at = nudge.indexOf('Read it with  ');
  assert.ok(at >= 0, `the nudge should say how to read the mail, got: ${nudge}`);
  return nudge.slice(at + 'Read it with  '.length);
}

/** The command `obk message to` hands back: the rest of its "Send it:" line. */
function sendCommandIn(said) {
  const line = said.split('\n').find((one) => one.includes('Send it:  '));
  assert.ok(line !== undefined, `the answer should say how to send it, got: ${said}`);
  return line.slice(line.indexOf('Send it:  ') + 'Send it:  '.length);
}

/**
 * The "Send it:" command with its placeholders filled in, the way a bot fills
 * them: each `<text>` becomes one quoted word. The rest is run as it was given.
 */
function filledIn(command, subject, text) {
  const words = [shellWord(subject), shellWord(text)];
  const filled = command.replace(/<text>/g, () => words.shift());
  assert.deepEqual(words, [], `the command should take a subject and a text, got: ${command}`);
  return filled;
}

test('the nudge names the CLI that sent the message', async (t) => {
  const box = await createSandbox(t);
  const bots = await mailFleet(box);

  const sent = await box.run(['message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily', '--subject', 'the staging host', '--text', 'It is down again.']);

  assert.equal(sent.code, 0, sent.stderr);
  assert.ok(
    startsWithCli(readCommandIn(await nudgeIn(box, bots)), box.cli, 'message check --bots '),
    `the command should start with the kit's own path, got: ${await nudgeIn(box, bots)}`,
  );
});

test('the command in the nudge, run as written in the reader\'s tab, reads the mail with the same CLI', async (t) => {
  const box = await createSandbox(t);
  const bots = await mailFleet(box);
  const sent = await box.run(['message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily', '--subject', 'the staging host', '--text', 'It is down again.']);
  assert.equal(sent.code, 0, sent.stderr);
  const other = await decoy(box);

  const read = await sh(readCommandIn(await nudgeIn(box, bots)), {
    cwd: box.cwd,
    env: { ...other.env, ORCA_TAB_ID: await tabOf(bots, 'coder') },
  });

  assert.equal(read.code, 0, read.stderr);
  assert.deepEqual(await other.runs(), [], 'the obk on PATH should never have been run');
  assert.ok(read.stdout.includes('It is down again.'), `the reader should have its mail, got: ${read.stdout}`);
});

test('the "Send it:" line names the CLI that answered, and runs as written from the sender\'s tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await mailFleet(box);
  const other = await decoy(box);

  const road = await box.run(['message', 'to', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily']);
  assert.equal(road.code, 0, road.stderr);
  const command = sendCommandIn(road.stdout);
  assert.ok(startsWithCli(command, box.cli, 'message send --bots '), `the command should start with the kit's own path, got: ${command}`);

  const sent = await sh(filledIn(command, 'the staging host', 'It is down again.'), {
    cwd: box.cwd,
    env: { ...other.env, ORCA_TAB_ID: await tabOf(bots, 'writer') },
  });

  assert.equal(sent.code, 0, `${sent.stdout}${sent.stderr}`);
  assert.deepEqual(await other.runs(), [], 'the obk on PATH should never have been run');
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one message in the mailbox, got: ${JSON.stringify(queued)}`);
  assert.equal(queued[0].subject, 'the staging host');
});

// ---------------------------------------------------------------------------
// A CLI whose path has a space in it
// ---------------------------------------------------------------------------

test('a CLI with a space in its path writes a hook that runs', async (t) => {
  const box = await createSandbox(t);
  const bots = await oneBot(box, 'claude');
  const cli = await linkedAt(box, 'the kit');

  const up = await runBy(box, cli, ['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  const hook = await kitHookOf(bots, 'api-bot', 'claude');
  assert.equal(plainCli(hook), hookLine(cli, bots, 'api-bot'));

  const tab = (await tabsOfBot(box, bots, 'api-bot'))[0];
  const ran = await throughAHarness(box, hook, { tab: tab.tabId, stdin: started('sess-spaced') });

  assert.equal(ran.code, 0, ran.stderr);
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, 'sess-spaced', `the hook should have recorded the session: ${hook}`);
});

test('a CLI with a space in its path types a launch line that hands it over whole', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await oneBot(box, 'codex');
  const cli = await linkedAt(box, 'the kit');

  const up = await runBy(box, cli, ['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  const typed = (await tabsOfBot(box, bots, 'api-bot'))[0].typed[0].text;
  const ran = await sh(`${typed}; :`, { cwd: box.cwd, env: box.env });

  assert.equal(ran.code, 0, ran.stderr);
  const calls = await fake.calls();
  assert.equal(calls.length, 1, `the line should start the harness once, got: ${typed}`);
  assert.equal(calls[0].env.OBK_CLI, cli, `got line: ${typed}`);
});

test('a CLI with a space in its path gives a nudge whose command reads the mail as written', async (t) => {
  const box = await createSandbox(t);
  const bots = await mailFleet(box);
  const cli = await linkedAt(box, 'the kit');
  const sent = await runBy(box, cli, ['message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily', '--subject', 'the staging host', '--text', 'It is down again.']);
  assert.equal(sent.code, 0, sent.stderr);
  const other = await decoy(box);

  const command = readCommandIn(await nudgeIn(box, bots));
  const read = await sh(command, { cwd: box.cwd, env: { ...other.env, ORCA_TAB_ID: await tabOf(bots, 'coder') } });

  assert.ok(startsWithCli(command, cli, 'message check '), `got: ${command}`);
  assert.equal(read.code, 0, `${command}\n${read.stderr}`);
  assert.deepEqual(await other.runs(), []);
  assert.ok(read.stdout.includes('It is down again.'), `got: ${read.stdout}`);
});

test('a CLI with a space in its path gives a "Send it:" line that sends as written', async (t) => {
  const box = await createSandbox(t);
  const bots = await mailFleet(box);
  const cli = await linkedAt(box, 'the kit');
  const other = await decoy(box);

  const road = await runBy(box, cli, ['message', 'to', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily']);
  assert.equal(road.code, 0, road.stderr);
  const command = sendCommandIn(road.stdout);
  const sent = await sh(filledIn(command, 'the staging host', 'It is down again.'), {
    cwd: box.cwd,
    env: { ...other.env, ORCA_TAB_ID: await tabOf(bots, 'writer') },
  });

  assert.ok(startsWithCli(command, cli, 'message send '), `got: ${command}`);
  assert.equal(sent.code, 0, `${command}\n${sent.stdout}${sent.stderr}`);
  assert.deepEqual(await other.runs(), []);
  assert.equal((await box.orca.messages()).length, 1, 'one message in the mailbox');
});

// ---------------------------------------------------------------------------
// A bots folder whose path has a space in it
// ---------------------------------------------------------------------------

// The mail commands carry the bots folder as well as the CLI, and a folder
// with a space in it is a path with a space in it: quoted, or the command the
// session copies does not run.

test('a bots folder with a space in its path gives a nudge whose command reads the mail as written', async (t) => {
  const box = await createSandbox(t);
  const bots = await mailFleet(box, 'my bots');
  const sent = await box.run(['message', 'send', '--bots', 'my bots', '--to', 'coder', '--from', 'writer/daily', '--subject', 'the staging host', '--text', 'It is down again.']);
  assert.equal(sent.code, 0, sent.stderr);
  const other = await decoy(box);

  const command = readCommandIn(await nudgeIn(box, bots));
  const read = await sh(command, { cwd: box.root, env: { ...other.env, ORCA_TAB_ID: await tabOf(bots, 'coder') } });

  assert.equal(read.code, 0, `${command}\n${read.stdout}${read.stderr}`);
  assert.deepEqual(await other.runs(), []);
  assert.ok(read.stdout.includes('It is down again.'), `the reader should have its mail, got: ${read.stdout}`);
});

test('a bots folder with a space in its path gives a "Send it:" line that sends as written', async (t) => {
  const box = await createSandbox(t);
  const bots = await mailFleet(box, 'my bots');
  const other = await decoy(box);

  const road = await box.run(['message', 'to', '--bots', 'my bots', '--to', 'coder', '--from', 'writer/daily']);
  assert.equal(road.code, 0, road.stderr);
  const command = sendCommandIn(road.stdout);
  const sent = await sh(filledIn(command, 'the staging host', 'It is down again.'), {
    cwd: box.root,
    env: { ...other.env, ORCA_TAB_ID: await tabOf(bots, 'writer') },
  });

  assert.equal(sent.code, 0, `${command}\n${sent.stdout}${sent.stderr}`);
  assert.deepEqual(await other.runs(), []);
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one message in the mailbox, got: ${JSON.stringify(queued)}`);
  assert.equal(queued[0].subject, 'the staging host');
});

// ---------------------------------------------------------------------------
// The other commands the kit hands a session to run
// ---------------------------------------------------------------------------

// A refusal a bot receives tells it what to run next, and the grooming prompt
// tells the grooming session what to count with. Each names the CLI that
// wrote it, and each runs as written. The wording around a command is the
// kit's, so a command is found by the CLI it starts with, and runs to the end
// of its line.

/**
 * The command in `said` that starts with `cli` (either spelling) and then
 * `rest`, up to the end of its line.
 */
function commandIn(said, cli, rest) {
  for (const line of said.split('\n')) {
    for (const word of spellingsOf(cli)) {
      const at = line.indexOf(`${word} ${rest}`);
      if (at >= 0) return line.slice(at).trim();
    }
  }
  return assert.fail(`there should be a command starting ${shellWord(cli)} ${rest}, got:\n${said}`);
}

/**
 * A mail fleet where one side has never been brought up, so it has no mailbox:
 * `writer` and `coder` as in `mailFleet`, and `later`, a Codex bot whose one
 * session was only written. `cli` runs everything.
 */
async function fleetWithOneNotUp(box, cli) {
  const bots = await mailFleet(box);
  assert.equal((await runBy(box, cli, ['bot', 'create', '--bots', bots, '--name', 'later', '--harness', 'codex'])).code, 0);
  assert.equal((await runBy(box, cli, ['session', 'add', '--bots', bots, '--bot', 'later', '--name', 'daily'])).code, 0);
  assert.equal((await sessionIn(bots, 'later', 'daily'))?.mailbox, undefined, 'later/daily has not been brought up');
  return bots;
}

for (const [label, folder] of [['', null], [' with a space in its path', 'the kit']]) {
  test(`a receiver never brought up: the command the refusal gives runs as written, by the CLI${label}`, async (t) => {
    const box = await createSandbox(t);
    const cli = folder === null ? box.cli : await linkedAt(box, folder);
    const bots = await fleetWithOneNotUp(box, cli);
    const other = await decoy(box);

    const refused = await runBy(box, cli, ['message', 'to', '--bots', bots, '--to', 'later/daily', '--from', 'writer/daily']);
    assert.equal(refused.code, 1, `a receiver with no mailbox is refused, got:\n${refused.stdout}${refused.stderr}`);
    const command = commandIn(refused.stdout + refused.stderr, cli, 'up --bots ');
    const ran = await sh(command, { cwd: box.root, env: other.env });

    assert.equal(ran.code, 0, `${command}\n${ran.stdout}${ran.stderr}`);
    assert.deepEqual(await other.runs(), [], 'the obk on PATH should never have been run');
    assert.notEqual((await sessionIn(bots, 'later', 'daily'))?.mailbox, undefined, `the command should have brought later/daily up: ${command}`);
  });

  test(`a sender never brought up: the command the refusal gives runs as written, by the CLI${label}`, async (t) => {
    const box = await createSandbox(t);
    const cli = folder === null ? box.cli : await linkedAt(box, folder);
    const bots = await fleetWithOneNotUp(box, cli);
    const other = await decoy(box);

    const refused = await runBy(box, cli, [
      'message', 'send', '--bots', bots, '--to', 'coder', '--from', 'later/daily', '--subject', 'hello', '--text', 'hi',
    ]);
    assert.equal(refused.code, 1, `a sender with no mailbox is refused, got:\n${refused.stdout}${refused.stderr}`);
    const command = commandIn(refused.stdout + refused.stderr, cli, 'up --bots ');
    const ran = await sh(command, { cwd: box.root, env: other.env });

    assert.equal(ran.code, 0, `${command}\n${ran.stdout}${ran.stderr}`);
    assert.deepEqual(await other.runs(), [], 'the obk on PATH should never have been run');
    assert.notEqual((await sessionIn(bots, 'later', 'daily'))?.mailbox, undefined, `the command should have brought later/daily up: ${command}`);
  });

  test(`the grooming prompt names the CLI that made it, and that CLI answers${label}`, async (t) => {
    // The grooming session is started by Orca's automation, not by a launch
    // line of the kit's, so it has no OBK_CLI to go by: the prompt itself has
    // to name the CLI. Its command has placeholders for the window, so what is
    // run here is the CLI word the prompt gives, asking for the same count.
    const box = await createSandbox(t);
    const cli = folder === null ? box.cli : await linkedAt(box, folder);
    assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
    const bots = box.path('bots');
    const other = await decoy(box);

    const made = await runBy(box, cli, ['groom', '--bots', bots, '--at', '04:00']);
    assert.equal(made.code, 0, made.stderr);
    const [automation] = (await box.orca.state()).automations ?? [];
    assert.ok(automation !== undefined, 'the grooming should have been made');
    const word = spellingsOf(cli).find((spelling) => automation.prompt.includes(`${spelling} usage `));
    assert.ok(word !== undefined, `the prompt should count with ${shellWord(cli)} usage, got: ${automation.prompt}`);
    const ran = await sh(`${word} usage --bots ${shellWord(bots)}`, { cwd: box.root, env: other.env });

    assert.equal(ran.code, 0, `${word} usage\n${ran.stdout}${ran.stderr}`);
    assert.deepEqual(await other.runs(), [], 'the obk on PATH should never have been run');
  });
}

// ---------------------------------------------------------------------------
// The mail rule in a bot's AGENTS.md
// ---------------------------------------------------------------------------

/** How the mail rule tells a bot to reach the kit: the launch line's CLI, or the machine's `obk` without one. */
const RULE_COMMAND = '"${OBK_CLI:-obk}" message to --bots <bots> --to <bot>/<session>';

test('a bot\'s AGENTS.md tells it to ask for the road through "${OBK_CLI:-obk}"', async (t) => {
  const box = await createSandbox(t);
  const bots = await mailFleet(box);

  const agents = await agentsIn(bots, 'writer');

  assert.ok(agents.includes(RULE_COMMAND), `the mail rule should give the command as ${RULE_COMMAND}, got:\n${agents}`);
});

test('the mail rule\'s command runs the CLI OBK_CLI names, and the obk on PATH when nothing names one', async (t) => {
  // A tab the kit started has OBK_CLI from its launch line; a shell anywhere
  // else has the machine's `obk`. The command has to work in both.
  const box = await createSandbox(t);
  const bots = await mailFleet(box);
  const agents = await agentsIn(bots, 'writer');
  assert.ok(agents.includes(RULE_COMMAND), `the mail rule should give the command as ${RULE_COMMAND}, got:\n${agents}`);
  const command = RULE_COMMAND.replace('<bots>', shellWord(bots)).replace('<bot>/<session>', 'coder/daily');
  const writerTab = await tabOf(bots, 'writer');
  const other = await decoy(box);

  const named = await sh(command, { cwd: box.cwd, env: { ...other.env, ORCA_TAB_ID: writerTab, OBK_CLI: box.cli } });
  const { OBK_CLI: _unset, ...plain } = box.env;
  const unnamed = await sh(command, { cwd: box.cwd, env: { ...plain, ORCA_TAB_ID: writerTab } });

  assert.equal(named.code, 0, named.stderr);
  assert.deepEqual(await other.runs(), [], 'with OBK_CLI set, the obk on PATH is not the one run');
  assert.ok(named.stdout.includes((await sessionIn(bots, 'coder', 'daily')).mailbox), `the road should be answered, got: ${named.stdout}`);
  assert.equal(unnamed.code, 0, `with no OBK_CLI it falls back to the obk on PATH: ${unnamed.stderr}`);
  assert.ok(unnamed.stdout.includes((await sessionIn(bots, 'coder', 'daily')).mailbox), `got: ${unnamed.stdout}`);
});

test('a bot\'s AGENTS.md is the same whichever CLI built it, and names no install path', async (t) => {
  // It is versioned with the bots folder and read on every machine the folder
  // is cloned to, so a path to one machine's install has no business in it.
  const box = await createSandbox(t);
  const bots = await mailFleet(box);
  const byLink = await agentsIn(bots, 'writer');
  const cli = await linkedAt(box, 'the kit');

  const rebuilt = await runBy(box, cli, ['rules', 'build', '--bots', 'bots', '--bot', 'writer']);

  assert.equal(rebuilt.code, 0, rebuilt.stderr);
  const bySpaced = await agentsIn(bots, 'writer');
  assert.equal(bySpaced, byLink, 'built by another CLI, the file should not change');
  for (const install of [box.cli, cli, cliEntry, path.dirname(cliEntry)]) {
    assert.ok(!bySpaced.includes(install), `AGENTS.md should not name ${install}`);
  }
});
