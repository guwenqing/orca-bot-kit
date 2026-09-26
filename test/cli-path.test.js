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
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

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
  recordSession,
  sessionIn,
  sh,
  shellWord,
  spellingsOf,
  tabsOfBot,
  throughAHarness,
  typedInto,
} from './helpers/cli.js';
import { addRules, agentsIn } from './helpers/rules.js';
import { addSkills, botYamlOf, defaultsOf } from './helpers/skills.js';
import { commitIn, putSkills, repoAt, sourcesYaml, writeSources } from './helpers/sources.js';

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
 * test says which CLI does it. `folder` is the bots folder's name in the
 * sandbox's working directory.
 */
async function oneBot(box, harness, bot = 'api-bot', folder = 'bots') {
  assert.equal((await box.run(['init', '--bots', folder, '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', folder, '--name', bot, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', folder, '--bot', bot, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path(folder);
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
  // A checkout's CLI, run by its path: what a system test's fleet holds.
  'a checkout\'s src/cli.js': `/work/obk-dev/src/cli.js session record --bots ${bots} --bot api-bot 2>/dev/null || true`,
  'a checkout\'s src/cli.js with a space in it': `'/work/space check/obk/src/cli.js' session record --bots ${bots} --bot api-bot 2>/dev/null || true`,
});

/**
 * The user's own lines that end the way the kit's does, under a program that
 * is not the kit: not `obk`, not a path whose last part is `obk`, not a path
 * ending in `/src/cli.js`. Each is theirs (PRD 6.5, #165), however close it
 * comes (review of PR #247: `echo …` was taken for the kit's and replaced).
 */
const theirLookAlikes = (bots) => Object.fromEntries([
  'echo',
  '/usr/bin/true',
  'my-obk',
  '/opt/tools/obk-wrapper',
  "'/their tools/not-obk'",
  '/opt/tools/cli.js',
  '/work/obk-dev/src/cli.jsx',
].map((program) => [program, `${program} session record --bots ${bots} --bot api-bot 2>/dev/null || true`]));

for (const harness of ['claude', 'codex']) {
  test(`a line of the user's that ends like the kit's, under a program that is not the kit, stays theirs on ${harness}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await oneBot(box, harness);
    const file = hookFileOf(bots, 'api-bot', harness);
    await mkdir(path.dirname(file), { recursive: true });

    for (const [program, theirs] of Object.entries(theirLookAlikes(bots))) {
      const group = { matcher: 'mine', hooks: [{ type: 'command', command: theirs, timeout: 10 }] };
      await writeFile(file, `${JSON.stringify({ hooks: { SessionStart: [group] } }, null, 2)}\n`);

      const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

      assert.equal(up.code, 0, `${program}: ${up.stderr}`);
      const held = await hooksIn(bots, 'api-bot', harness);
      const now = await readFile(file, 'utf8');
      assert.ok(
        eventsIn(held).SessionStart.some((one) => isDeepStrictEqual(one, group)),
        `${program}: their entry should be there exactly as they wrote it, got:\n${now}`,
      );
      assert.deepEqual(
        commandsUnder(held, 'SessionStart').map(plainCli).sort(),
        [hookLine(box.cli, bots, 'api-bot'), theirs].sort(),
        `${program}: and the kit's own line beside it, got:\n${now}`,
      );
    }
  });
}

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

// A refusal a bot receives tells it what to run next, and the grooming line
// tells the grooming session which kit to run. Each names the CLI that
// wrote it, and each runs as written. The wording around a command is the
// kit's, so a command is found by the CLI it starts with, and runs to the end
// of its line.

/**
 * The command in `said` that starts with `cli` (either spelling) and then
 * `rest`, up to the end of its line; with `has`, the first such command that
 * holds each of those words as well.
 */
function commandIn(said, cli, rest, has = []) {
  for (const line of said.split('\n')) {
    for (const word of spellingsOf(cli)) {
      const at = line.indexOf(`${word} ${rest}`);
      const command = line.slice(at).trim();
      if (at >= 0 && has.every((part) => command.includes(part))) return command;
    }
  }
  return assert.fail(`there should be a command starting ${shellWord(cli)} ${rest}${has.length > 0 ? ` with ${has.join(', ')}` : ''}, got:\n${said}`);
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

  test(`the grooming lines name the CLI that typed them, and that CLI answers${label}`, async (t) => {
    // `obk groom --on --at` types into the grooming tab the run the schedule
    // will make every day, and `--now` the same run once. The skills that run
    // works by say `obk`, and the tab may have been launched by another kit
    // than the one that typed the line, so the line names the kit that typed
    // it, by its own path, spelled so a shell runs it as one word. What is run
    // here is that word, asking for a count as the run does.
    const box = await createSandbox(t);
    const cli = folder === null ? box.cli : await linkedAt(box, folder);
    assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'bot-father', '--name', 'grooming']);
    assert.equal(added.code, 0, added.stderr);
    assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
    const bots = box.path('bots');
    const tab = (await sessionIn(bots, 'bot-father', 'grooming')).tab;
    const typedInGrooming = async () => (await box.orca.terminals()).find((one) => one.tabId === tab)?.typed ?? [];
    const other = await decoy(box);

    for (const flags of [['--on', '--at', '04:00'], ['--now']]) {
      const before = (await typedInGrooming()).length;
      const made = await runBy(box, cli, ['groom', '--bots', bots, ...flags]);
      assert.equal(made.code, 0, made.stderr);
      const lines = (await typedInGrooming()).slice(before).map((entry) => entry.text);
      assert.equal(lines.length, 1, `groom ${flags.join(' ')} should type one line into the grooming tab, got: ${JSON.stringify(lines)}`);
      const word = spellingsOf(cli).find((spelling) => lines[0].includes(spelling));
      assert.ok(word !== undefined, `groom ${flags.join(' ')}: the line should name ${shellWord(cli)}, got: ${lines[0]}`);
      const ran = await sh(`${word} usage --bots ${shellWord(bots)}`, { cwd: box.root, env: other.env });
      assert.equal(ran.code, 0, `${word} usage\n${ran.stdout}${ran.stderr}`);
    }
    assert.deepEqual(await other.runs(), [], 'the obk on PATH should never have been run');
  });
}

// ---------------------------------------------------------------------------
// The commands the kit fills in for its caller to run next
// ---------------------------------------------------------------------------

// A report that ends in a complete command — the real bots folder filled in —
// hands it to whoever ran the kit, a person or a bot, to run next. A caller who
// ran a checkout by its path and follows the line has to reach that checkout
// again, not the machine's `obk` (#220, review of PR #247: `Bring it up` after
// a checkout's `session add` ran the decoy). Each is run here by a CLI whose
// path has a space in it, so a line that names it without quoting it names
// something else. The `--help` text, commands with a `<path>` to fill in, and
// prose such as "obk up puts it back" stay as they are, and are not here.
//
// And the bots folder is one with a space in its path, for the same reason: it
// is filled into the command too, and a folder that is not quoted there is two
// words (second review of PR #247: `up --bots my bots` was refused).

/** The bots folder every case here works in, inside the sandbox's working directory. */
const BOTS_DIR = 'my bots';

/** The bots folder as one word of a shell line, however the kit spells it. */
const botsWordIn = (command, bots) => spellingsOf(bots).some((word) => command.includes(`--bots ${word} `) || command.endsWith(`--bots ${word}`));

/** A bots folder with Bot Father, from the sandbox's own `obk`. */
async function seeded(box) {
  const init = await box.run(['init', '--bots', BOTS_DIR, '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
}

/** `oneBot`'s api-bot, brought up. */
async function botUp(box) {
  await oneBot(box, 'claude', 'api-bot', BOTS_DIR);
  const up = await box.run(['up', '--bots', BOTS_DIR, '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
}

/**
 * `botUp`, with the conversation its tab is running in the book, which is what
 * a pause needs before it will close the tab.
 */
async function botRunning(box) {
  await botUp(box);
  const bots = box.path(BOTS_DIR);
  const tab = (await sessionIn(bots, 'api-bot', 'daily')).tab;
  const ran = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-1' });
  assert.equal(ran.code, 0, ran.stderr);
}

/** `botRunning`, then paused. */
async function botPaused(box) {
  await botRunning(box);
  const paused = await box.run(['pause', '--bots', BOTS_DIR, '--bot', 'api-bot']);
  assert.equal(paused.code, 0, paused.stderr);
}

/** Bot Father with a session called grooming added and, with `up`, brought up, with nothing scheduled in it. */
async function groomingAdded(box, { up = false } = {}) {
  await seeded(box);
  const added = await box.run(['session', 'add', '--bots', BOTS_DIR, '--bot', 'bot-father', '--name', 'grooming']);
  assert.equal(added.code, 0, added.stderr);
  if (up) {
    const brought = await box.run(['up', '--bots', BOTS_DIR]);
    assert.equal(brought.code, 0, brought.stderr);
  }
}

/** A rule unit no rules folder has, so a bot that names it cannot have its AGENTS.md built. */
const NO_SUCH_UNIT = 'no-such-unit';

/**
 * A repository of skills in the sandbox, listed in `skills.yaml` as
 * `someones-skills`, and fetched. `sha` pins the entry to a commit instead.
 */
async function sourceListed(box, { fetch = true, sha } = {}) {
  await seeded(box);
  const repo = path.join(box.root, 'their-repo');
  await repoAt(repo);
  await putSkills(repo, { 'their-skill': 'Their skill.' });
  await commitIn(repo, 'their skill');
  const bots = box.path(BOTS_DIR);
  await writeSources(bots, sourcesYaml({ name: 'someones-skills', repo, ref: 'main', ...(sha === undefined ? {} : { sha }) }));
  if (fetch) {
    const fetched = await box.run(['skills', 'fetch', '--bots', BOTS_DIR]);
    assert.equal(fetched.code, 0, `${fetched.stderr}${fetched.stdout}`);
  }
  return repo;
}

/**
 * Each report that ends in a command to run next: what it takes to get there,
 * the run whose report it is, the words after the CLI that start the command,
 * any words further on that make it the command meant (`has`), and whether the
 * command as printed is one that can be run as it stands
 * (`runs`), with nothing to fill in and nothing outside the sandbox to reach.
 * A command inside a sentence runs on to the sentence's own words, and is not
 * run here either.
 */
const FOLLOW_UPS = {
  'pause says how to bring the bot back': {
    setup: botRunning,
    args: ['pause', '--bots', BOTS_DIR, '--bot', 'api-bot'],
    rest: 'unpause --bots ',
    runs: true,
  },
  'up says how to bring a paused bot back': {
    setup: botPaused,
    args: ['up', '--bots', BOTS_DIR],
    rest: 'unpause --bots ',
    runs: true,
  },
  'bot create says how to give the bot a session': {
    setup: seeded,
    args: ['bot', 'create', '--bots', BOTS_DIR, '--name', 'api-bot', '--harness', 'claude'],
    rest: 'session add --bots ',
    runs: false,
  },
  'session add says how to bring the session up': {
    setup: async (box) => {
      await seeded(box);
      assert.equal((await box.run(['bot', 'create', '--bots', BOTS_DIR, '--name', 'api-bot', '--harness', 'claude'])).code, 0);
    },
    args: ['session', 'add', '--bots', BOTS_DIR, '--bot', 'api-bot', '--name', 'daily'],
    rest: 'up --bots ',
    runs: true,
  },
  'session change says how to restart the session': {
    setup: botUp,
    args: ['session', 'change', '--bots', BOTS_DIR, '--bot', 'api-bot', '--session', 'daily', '--model', 'sonnet'],
    rest: 'restart --bots ',
    runs: false,
  },
  'skills add says how to link the skill': {
    setup: botUp,
    args: ['skills', 'add', '--bots', BOTS_DIR, '--bot', 'api-bot', '--skill', 'kit:obk-tdd'],
    rest: 'skills build --bots ',
    runs: true,
  },
  'skills remove says how to unlink the skill': {
    setup: async (box) => {
      await botUp(box);
      assert.equal((await box.run(['skills', 'add', '--bots', BOTS_DIR, '--bot', 'api-bot', '--skill', 'kit:obk-tdd'])).code, 0);
    },
    args: ['skills', 'remove', '--bots', BOTS_DIR, '--bot', 'api-bot', '--skill', 'kit:obk-tdd'],
    rest: 'skills build --bots ',
    runs: true,
  },
  'source add says how to fetch the source': {
    setup: seeded,
    args: ['source', 'add', '--bots', BOTS_DIR, '--name', 'someones-skills', '--repo', 'https://github.com/someone/skills', '--ref', 'v1.2.0'],
    rest: 'skills fetch --bots ',
    // It would reach a repository on the network.
    runs: false,
  },
  'groom with no grooming session says how to add one': {
    setup: seeded,
    args: ['groom', '--bots', BOTS_DIR],
    rest: 'session add --bots ',
    has: ['--bot bot-father', '--name grooming'],
    // The session's other settings are the user's to choose.
    runs: false,
  },
  'groom with the grooming session not up says how to bring it up': {
    setup: (box) => groomingAdded(box),
    args: ['groom', '--bots', BOTS_DIR],
    rest: 'up --bots ',
    runs: true,
  },
  'groom with grooming off says how to turn it on': {
    setup: (box) => groomingAdded(box, { up: true }),
    args: ['groom', '--bots', BOTS_DIR],
    rest: 'groom --bots ',
    has: ['--on', '--at'],
    // It has a time to fill in.
    runs: false,
  },
  'bot create whose rules cannot be built says how to build them': {
    setup: async (box) => {
      await seeded(box);
      await addRules(defaultsOf(box.path(BOTS_DIR)), NO_SUCH_UNIT);
    },
    args: ['bot', 'create', '--bots', BOTS_DIR, '--name', 'api-bot', '--harness', 'claude'],
    rest: 'rules build --bots ',
    runs: false,
  },
  'bot change whose rules cannot be built says how to build them': {
    setup: async (box) => {
      await oneBot(box, 'claude', 'api-bot', BOTS_DIR);
      await addRules(botYamlOf(box.path(BOTS_DIR), 'api-bot'), NO_SUCH_UNIT);
    },
    args: ['bot', 'change', '--bots', BOTS_DIR, '--bot', 'api-bot', '--charter', 'Api Bot owns the API now.'],
    rest: 'rules build --bots ',
    runs: false,
  },
  'restart of a paused bot says how to bring it back': {
    setup: botPaused,
    args: ['restart', '--bots', BOTS_DIR, '--bot', 'api-bot'],
    rest: 'unpause --bots ',
    runs: false,
  },
  'restart of a paused session says how to bring it back': {
    setup: async (box) => {
      await botRunning(box);
      const paused = await box.run(['pause', '--bots', BOTS_DIR, '--bot', 'api-bot', '--session', 'daily']);
      assert.equal(paused.code, 0, paused.stderr);
    },
    args: ['restart', '--bots', BOTS_DIR, '--bot', 'api-bot', '--session', 'daily'],
    rest: 'unpause --bots ',
    runs: false,
  },
  'restart whose closed tab Orca goes on listing says how to bring it back': {
    setup: async (box) => {
      await botRunning(box);
      // Orca answers the close and never stops listing the tab (fake-orca's
      // closeLag), so the kit gives up waiting and opens nothing.
      await box.orca.set({ closeLag: 100000 });
    },
    args: ['restart', '--bots', BOTS_DIR, '--bot', 'api-bot'],
    rest: 'up --bots ',
    runs: false,
  },
  'restart that closed one tab and could not close the next says how to bring it back': {
    setup: async (box) => {
      await oneBot(box, 'claude', 'api-bot', BOTS_DIR);
      const bots = box.path(BOTS_DIR);
      assert.equal((await box.run(['session', 'add', '--bots', BOTS_DIR, '--bot', 'api-bot', '--name', 'night'])).code, 0);
      assert.equal((await box.run(['up', '--bots', BOTS_DIR, '--bot', 'api-bot'])).code, 0);
      for (const [name, session] of [['daily', 'sess-1'], ['night', 'sess-2']]) {
        const tab = (await sessionIn(bots, 'api-bot', name)).tab;
        assert.equal((await recordSession(box, { bots, bot: 'api-bot', tab, session })).code, 0);
      }
      // The first close goes through and the second is refused.
      await box.orca.set({ fail: { 'terminal close': { code: 'runtime_error', message: 'the tab will not close', after: 1 } } });
    },
    args: ['restart', '--bots', BOTS_DIR, '--bot', 'api-bot'],
    rest: 'up --bots ',
    runs: false,
  },
  'skills build with a source not fetched says how to fetch it': {
    setup: async (box) => {
      await sourceListed(box, { fetch: false });
      assert.equal((await box.run(['bot', 'create', '--bots', BOTS_DIR, '--name', 'api-bot', '--harness', 'claude'])).code, 0);
      await addSkills(botYamlOf(box.path(BOTS_DIR), 'api-bot'), 'someones-skills:their-skill');
    },
    args: ['skills', 'build', '--bots', BOTS_DIR, '--bot', 'api-bot'],
    rest: 'skills fetch --bots ',
    runs: false,
  },
  'skills fetch of a clone from another repository says how to update it': {
    setup: async (box) => {
      await sourceListed(box);
      const elsewhere = path.join(box.root, 'their-fork');
      await repoAt(elsewhere);
      await putSkills(elsewhere, { 'their-skill': 'Their fork of it.' });
      await commitIn(elsewhere, 'the fork');
      await writeSources(box.path(BOTS_DIR), sourcesYaml({ name: 'someones-skills', repo: elsewhere, ref: 'main' }));
    },
    args: ['skills', 'fetch', '--bots', BOTS_DIR],
    rest: 'skills update --source ',
    runs: false,
  },
  'skills fetch of a pinned commit the repository no longer has says how to update it': {
    setup: (box) => sourceListed(box, { fetch: false, sha: '0123456789abcdef0123456789abcdef01234567' }),
    args: ['skills', 'fetch', '--bots', BOTS_DIR],
    rest: 'skills update --source ',
    runs: false,
  },
  'roster with no bots says how to make one': {
    setup: async (box) => {
      await seeded(box);
      await rm(path.join(box.path(BOTS_DIR), 'bots', 'bot-father'), { recursive: true, force: true });
    },
    args: ['roster', '--bots', BOTS_DIR],
    rest: 'bot create --bots ',
    runs: false,
  },
};

for (const [label, { setup, args, rest, has, runs }] of Object.entries(FOLLOW_UPS)) {
  test(`${label}, by the CLI that answered`, async (t) => {
    const box = await createSandbox(t);
    await setup(box);
    const cli = await linkedAt(box, 'the kit');

    const answered = await runBy(box, cli, args);

    const command = commandIn(answered.stdout + answered.stderr, cli, rest, has);
    if (rest.includes('--bots')) {
      assert.ok(
        botsWordIn(command, box.path(BOTS_DIR)),
        `the bots folder should be one word of the command, quoted as a shell needs it: ${shellWord(box.path(BOTS_DIR))}\ngot: ${command}`,
      );
    }
    if (!runs) return;
    const other = await decoy(box);
    const ran = await sh(command, { cwd: box.root, env: other.env });
    assert.equal(ran.code, 0, `${command}\n${ran.stdout}${ran.stderr}`);
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
