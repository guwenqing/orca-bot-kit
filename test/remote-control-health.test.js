// `obk health` says whether Remote Control is on for each Claude Code session
// (#755, R1), section 5 of the test brief.
//
// R1, as the owner signed it: "When Remote Control cannot start, the session
// MUST still start, and `obk health` MUST say that Remote Control is off for
// it."
//
// As decided on #755 (design part 3):
//
//   RH1  Health reads, for each Claude session it lists in `sessions`, the
//        session's own entry in Claude Code's registry, `sessions/<pid>.json`,
//        where <pid> is the pid of the harness in front of the session's tab.
//        The entry's own `pid` must be that pid. It looks in
//          1. $CLAUDE_CONFIG_DIR/sessions, when CLAUDE_CONFIG_DIR is set;
//          2. ~/.claude/sessions;
//          3. <Orca data>/claude-profiles/*/home/sessions;
//        and the first entry found counts.
//   RH1a The entry must be the live process's own, not one an older process
//        with the same pid left behind (the review of #755). Claude Code
//        writes `procStart` in each entry: the process's start time as
//        `ps -o lstart=` prints it with TZ=UTC and LC_ALL=C, as Claude Code
//        2.1.325 reads it (ADR 0058), for example `Sat Nov 14 22:28:50 2026`,
//        with two blanks before a one-digit day. Health reads how long ago the
//        live process started, `ps -o etime= -p <pid>`, with no environment of
//        its own, takes now minus that as its start, reads procStart as that
//        UTC, C-locale text, and counts the entry when the two agree within
//        the truncation of whole seconds on both sides: a few seconds, never
//        a minute. The kit's own TZ and locale do not change the result. An
//        entry whose pid matches and whose procStart is missing, is not a
//        readable time, or is another start is stale: health skips it and
//        goes on to the next folder; the first entry that matches both
//        counts. No entry that matches both is `unknown`, with a why. A start
//        time the kit cannot read (ps fails or prints nothing) is `unknown`,
//        with a why: the kit cannot tell its entry from a stale one, and it
//        does not fall back to the pid alone.
//   RH2  The state, from the entry's `bridgeSessionId`: a string that is not
//        empty is `enabled`; `null`, or no such key, is `not enabled`; any other
//        type is `unknown`; and no entry, or one that cannot be read or parsed,
//        is `unknown`.
//   RH3  JSON: each Claude session in `sessions` gets
//        `remote_control: { asked, from, state }`, with `why` (a string) only
//        when the state is unknown. `asked` is on or off, `from` is session or
//        kit default. Codex and Pi sessions get none.
//   RH4  Text: the session's line ends with `  remote control <state> (asked
//        <on|off>)`, for Claude sessions only.
//   RH5  Findings, category `session`: asked on and not enabled says
//        "Remote Control is not on for <bot>'s session <name>" and "Its tab says
//        why"; asked off and enabled says "<bot>'s session <name> is set off,
//        but Remote Control is enabled in it", names the cold restore, names
//        obk restart, and names `"disableRemoteControl": true` in
//        `.claude/settings.local.json` as the hard off. Unknown gives none; on
//        and enabled, or off and not enabled, give none. For a session set off
//        whose own extra_args carry --settings, the off-and-enabled finding
//        names its own --settings as the reason and the hard off, and does
//        not give obk restart as the way to turn it off: a restart still
//        sends its own --settings (the review of #755).
//   RH6  A hand-written `--remote-control` or `--rc` in a session's extra_args
//        is a finding of category `config` that names `<bot>'s session <name>`
//        and `--remote-control on|off`. It needs no harness running.
//   RH6a A Claude session whose own extra_args carry --settings (two words,
//        `--settings=<x>`, or in one string of shell text) is a finding of
//        category `config`: "<bot>'s session <name> carries its own
//        --settings in <bot.yaml>, which replaces the kit's, so it runs
//        without: <what>. To give it back, take --settings out of its
//        extra_args." <what> is "its bot's own memory folder" (ADR 0060), and
//        then ", Remote Control off" when the session is set off. It needs no
//        harness running. A session set off without its own --settings gets
//        none.
//   RH7  Health never says "connected" about Remote Control: the registry
//        shows a handle, not a connection.
//
// The registry is written into the sandbox's own home (helpers/claude-registry.js),
// and the fake ps gives the harness in a tab the pid 40000 + 10 x terminal + 2
// (helpers/fake-ps.js). Nothing here reads the real ~/.claude or the real Orca.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { createSandbox } from './helpers/cli.js';
import { defaultConfigDir, listInRegistry, livePidOf } from './helpers/claude-registry.js';
import { PS_ELAPSED, PS_START, lstartOf, tabStartOf } from './helpers/fake-ps.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';

/** A bridge id, as Claude Code writes one when Remote Control has its handle. */
const BRIDGE = 'cse_01J9ZQ4RemoteHandle';

// ------------------------------------------------------------- the fleet

/** A run of `obk` that must go through. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have gone through:\n${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Bot Father and api-bot on Claude Code, with daily, `keys` written into its
 * entry by hand, and with `codex: true` a Codex session review beside it.
 * Brought up unless `up` is false.
 */
async function fleetIn(box, { keys = {}, codex = false, up = true } = {}) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  if (codex) await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'review', '--harness', 'codex']);
  const bots = box.path('bots');
  if (Object.keys(keys).length > 0) {
    const file = botYamlOf(bots, BOT);
    const doc = parse(await readFile(file, 'utf8'));
    doc.sessions = doc.sessions.map((one) => (one.name === 'daily' ? { ...one, ...keys } : one));
    await writeFile(file, stringify(doc));
  }
  if (up) await ok(box, ['up', '--bots', 'bots', '--bot', BOT]);
  return bots;
}

/**
 * Claude Code's registry entry for the process `pid`, with `bridge` as its
 * bridgeSessionId, or no such key when it is ABSENT, and `procStart` as the
 * process's start time, or no such key when it is ABSENT.
 */
const entryFor = (box, pid, bridge, procStart = ABSENT) => ({
  pid,
  ...(procStart === ABSENT ? {} : { procStart }),
  sessionId: '0199b2c0-0318-4444-8888-aaaaaaaaaaaa',
  cwd: box.cwd,
  startedAt: Date.UTC(2026, 10, 14, 1, 0, 0),
  kind: 'interactive',
  name: `${BOT}.daily.abcd1234`,
  status: 'idle',
  ...(bridge === ABSENT ? {} : { bridgeSessionId: bridge }),
});

const ABSENT = Symbol('absent');

/**
 * The start time of the harness in front of daily's tab, as Claude Code writes
 * it into its entry as `procStart`: `ps -o lstart=` in UTC, which is what the
 * fake ps answers for that process (helpers/fake-ps.js).
 */
async function liveStartOf(box, pid) {
  return lstartOf(tabStartOf(await box.orca.state(), pid));
}

/** A start time an hour before the live harness's: an older process that had the same pid. */
async function staleStartOf(box, pid) {
  return lstartOf(tabStartOf(await box.orca.state(), pid) - 3600 * 1000);
}

/**
 * Make the harness `pid` start `ago` ms before now, on a whole second, or with
 * `late` 999 ms into that second, and return the start in ms. The kit reads it
 * as now minus `ps -o etime=`, so it must be in the past.
 */
async function startedAgo(box, pid, ago, { late = false } = {}) {
  const at = Math.floor((Date.now() - ago) / 1000) * 1000 + (late ? 999 : 0);
  await box.orca.set({ psStarts: { [pid]: at } });
  return at;
}

/**
 * Write daily's registry entry into `configDir`'s registry, for the pid of the
 * harness in front of its tab. Its `procStart` is that harness's start time,
 * unless `procStart` says otherwise (ABSENT leaves the key out).
 */
async function registered(box, bots, bridge, { configDir = defaultConfigDir(box), pid, procStart } = {}) {
  const live = await livePidOf(box, bots, BOT, 'daily');
  const start = procStart === undefined ? await liveStartOf(box, live) : procStart;
  await listInRegistry(box, 'unused', { pid: live, configDir, entry: entryFor(box, pid ?? live, bridge, start) });
  return live;
}

/** An Orca Claude profile's home in the sandbox: `<Orca data>/claude-profiles/<name>/home`. */
const profileHome = (box, name = 'profile-one') => path.join(box.home, 'Library', 'Application Support', 'orca', 'claude-profiles', name, 'home');

/** `obk health`, plain or as JSON, with `env` added to the sandbox's. It may exit 1: a finding is not a failure. */
async function health(box, { json = true, env = {} } = {}) {
  const result = await box.run(['health', '--bots', 'bots', ...(json ? ['--json'] : [])], { env: { ...box.env, ...env } });
  assert.ok(result.code === 0 || result.code === 1, `health should answer, got ${result.code}:\n${result.stdout}${result.stderr}`);
  if (!json) return result;
  try {
    return { ...result, answer: JSON.parse(result.stdout) };
  } catch (error) {
    return assert.fail(`--json should print JSON, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/** One session's entry in health's `sessions`. */
function sessionOf(answer, name = 'daily') {
  const found = (answer.sessions ?? []).filter((one) => one.bot === BOT && one.session === name);
  assert.equal(found.length, 1, `health should list ${BOT} ${name} once, got: ${JSON.stringify(answer.sessions)}`);
  return found[0];
}

/** The findings about Remote Control. */
const remoteFindings = (answer) => (answer.found ?? []).filter((one) => /remote.control|--rc\b/i.test(one.says ?? ''));

/** The state health gives daily, and that the rest of its remote_control is as asked. */
async function stateOf(box, { asked = 'on', from = 'kit default', env } = {}) {
  const { answer } = await health(box, { env });
  const remote = sessionOf(answer).remote_control;
  assert.ok(remote && typeof remote === 'object', `daily should carry remote_control, got: ${JSON.stringify(sessionOf(answer))}`);
  assert.equal(remote.asked, asked, `got: ${JSON.stringify(remote)}`);
  assert.equal(remote.from, from, `got: ${JSON.stringify(remote)}`);
  return remote;
}

/** An unknown state, with a why that says something. */
function assertUnknown(remote) {
  assert.equal(remote.state, 'unknown', `got: ${JSON.stringify(remote)}`);
  assert.equal(typeof remote.why, 'string', `an unknown state says why, got: ${JSON.stringify(remote)}`);
  assert.notEqual(remote.why.trim(), '', 'a why with words in it');
}

// ------------------------------------------------------------- RH2 the state, RH3 the JSON

for (const [label, bridge, state] of [
  ['a bridgeSessionId that is a string', BRIDGE, 'enabled'],
  ['a bridgeSessionId of null', null, 'not enabled'],
  ['no bridgeSessionId key', ABSENT, 'not enabled'],
]) {
  test(`RH2 an entry with ${label} is ${state}, and the JSON is exactly { asked, from, state }, with no why`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await registered(box, bots, bridge);

    const { answer } = await health(box);

    assert.deepEqual(sessionOf(answer).remote_control, { asked: 'on', from: 'kit default', state });
  });
}

for (const [label, bridge] of [['a number', 42], ['an object', { id: BRIDGE }], ['an empty string', ''], ['a boolean', true]]) {
  test(`RH2 an entry whose bridgeSessionId is ${label} is unknown, with a why`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await registered(box, bots, bridge);

    assertUnknown(await stateOf(box));
  });
}

test('RH2 no entry in any registry is unknown, with a why', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  assertUnknown(await stateOf(box));
});

test('RH2 an entry that is not JSON is unknown, with a why', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const pid = await livePidOf(box, bots, BOT, 'daily');
  await listInRegistry(box, 'unused', { pid, entry: `{"pid": ${pid}, "bridgeSessionId": "${BRIDGE}"` });

  assertUnknown(await stateOf(box));
});

test('RH1 an entry named for the pid whose own pid is another process\'s does not count: unknown', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await registered(box, bots, BRIDGE, { pid: 49992 });

  assertUnknown(await stateOf(box));
});

test('RH1 an entry for another pid, another session\'s harness, does not count for daily', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const live = await livePidOf(box, bots, BOT, 'daily');
  await listInRegistry(box, 'unused', { pid: live + 1000, entry: entryFor(box, live + 1000, BRIDGE, await liveStartOf(box, live)) });

  assertUnknown(await stateOf(box));
});

test('RH3 a session set off: asked off, from the session', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { keys: { remote_control: 'off' } });
  await registered(box, bots, null);

  const { answer } = await health(box);

  assert.deepEqual(sessionOf(answer).remote_control, { asked: 'off', from: 'session', state: 'not enabled' });
});

test('RH3 a session set on: asked on, from the session', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { keys: { remote_control: 'on' } });
  await registered(box, bots, BRIDGE);

  const { answer } = await health(box);

  assert.deepEqual(sessionOf(answer).remote_control, { asked: 'on', from: 'session', state: 'enabled' });
});

test('RH3 a Codex session gets no remote_control, beside a Claude session that does', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { codex: true });
  await registered(box, bots, BRIDGE);

  const { answer } = await health(box);

  assert.equal('remote_control' in sessionOf(answer, 'review'), false, `got: ${JSON.stringify(sessionOf(answer, 'review'))}`);
  assert.equal(sessionOf(answer, 'daily').remote_control?.state, 'enabled', 'the presence beside it');
});

// ------------------------------------------------------------- RH1 where health looks

test('RH1 CLAUDE_CONFIG_DIR set: health reads its sessions folder', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const configDir = path.join(box.root, 'claude-config');
  await registered(box, bots, BRIDGE, { configDir });

  assert.equal((await stateOf(box, { env: { CLAUDE_CONFIG_DIR: configDir } })).state, 'enabled');
});

test('RH1 an Orca Claude profile\'s sessions folder is read too: a tab can run under a profile that is not the caller\'s', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await registered(box, bots, BRIDGE, { configDir: profileHome(box) });

  assert.equal((await stateOf(box)).state, 'enabled');
});

test('RH1 with CLAUDE_CONFIG_DIR set and nothing there, ~/.claude/sessions is still read', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const configDir = path.join(box.root, 'claude-config');
  await mkdir(path.join(configDir, 'sessions'), { recursive: true });
  await registered(box, bots, BRIDGE);

  assert.equal((await stateOf(box, { env: { CLAUDE_CONFIG_DIR: configDir } })).state, 'enabled');
});

test('RH1 the first entry found counts: CLAUDE_CONFIG_DIR before ~/.claude', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const configDir = path.join(box.root, 'claude-config');
  await registered(box, bots, null, { configDir });
  await registered(box, bots, BRIDGE);

  assert.equal((await stateOf(box, { env: { CLAUDE_CONFIG_DIR: configDir } })).state, 'not enabled');
});

test('RH1 the first entry found counts: ~/.claude before an Orca profile', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await registered(box, bots, BRIDGE);
  await registered(box, bots, null, { configDir: profileHome(box) });

  assert.equal((await stateOf(box)).state, 'enabled');
});

// ------------------------------------------------------------- RH1a a stale entry under the same pid

test('RH1a a stale entry (same pid, another procStart) in ~/.claude does not count: the live one in an Orca profile does, not enabled, with its finding', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const live = await livePidOf(box, bots, BOT, 'daily');
  await registered(box, bots, BRIDGE, { procStart: await staleStartOf(box, live) });
  await registered(box, bots, null, { configDir: profileHome(box) });

  const { answer } = await health(box);

  assert.deepEqual(sessionOf(answer).remote_control, { asked: 'on', from: 'kit default', state: 'not enabled' });
  const found = remoteFindings(answer);
  assert.equal(found.length, 1, `one finding about Remote Control, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.equal(found[0].kind, 'session');
  assert.ok(found[0].says.includes(`Remote Control is not on for ${BOT}'s session daily`), `got: ${found[0].says}`);
});

test('RH1a the reverse: a stale entry of null in ~/.claude does not count, the live one in an Orca profile is enabled', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const live = await livePidOf(box, bots, BOT, 'daily');
  await registered(box, bots, null, { procStart: await staleStartOf(box, live) });
  await registered(box, bots, BRIDGE, { configDir: profileHome(box) });

  const { answer } = await health(box);

  assert.deepEqual(sessionOf(answer).remote_control, { asked: 'on', from: 'kit default', state: 'enabled' });
  assert.deepEqual(remoteFindings(answer), []);
});

test('RH1a a stale entry in CLAUDE_CONFIG_DIR does not count either: the live one in ~/.claude does', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const live = await livePidOf(box, bots, BOT, 'daily');
  const configDir = path.join(box.root, 'claude-config');
  await registered(box, bots, null, { configDir, procStart: await staleStartOf(box, live) });
  await registered(box, bots, BRIDGE);

  assert.equal((await stateOf(box, { env: { CLAUDE_CONFIG_DIR: configDir } })).state, 'enabled');
});

test('RH1a an entry with no procStart is skipped: the live one after it counts', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await registered(box, bots, BRIDGE, { procStart: ABSENT });
  await registered(box, bots, null, { configDir: profileHome(box) });

  assert.equal((await stateOf(box)).state, 'not enabled');
});

test('RH1a only stale entries, one with another procStart and one with none: unknown, with a why, and no finding', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const live = await livePidOf(box, bots, BOT, 'daily');
  await registered(box, bots, BRIDGE, { procStart: await staleStartOf(box, live) });
  await registered(box, bots, null, { configDir: profileHome(box), procStart: ABSENT });

  const { answer } = await health(box);

  const remote = sessionOf(answer).remote_control;
  assertUnknown(remote);
  assert.equal(remote.asked, 'on');
  assert.deepEqual(remoteFindings(answer), []);
});

test('RH1a one stale entry of null alone: unknown, with a why, and not the finding that Remote Control is not on', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const live = await livePidOf(box, bots, BOT, 'daily');
  await registered(box, bots, null, { procStart: await staleStartOf(box, live) });

  const { answer } = await health(box);

  assertUnknown(sessionOf(answer).remote_control);
  assert.deepEqual(remoteFindings(answer), []);
});

for (const [label, change] of [
  ['ps fails on it', (pid) => ({ psStartErrors: { [pid]: 'ps: sysctl failed' } })],
  ['ps prints nothing for it', (pid) => ({ psStarts: { [pid]: null } })],
]) {
  test(`RH1a the live process's start time cannot be read (${label}): unknown, with a why, and no finding, though a valid-looking entry is there`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    // The entry is written with the start time the fake gives before the change.
    const live = await registered(box, bots, null);
    await box.orca.set(change(live));

    const { answer } = await health(box);

    const remote = sessionOf(answer).remote_control;
    assertUnknown(remote);
    assert.equal(remote.asked, 'on');
    assert.deepEqual(remoteFindings(answer), [], 'no finding: the kit cannot tell its entry from a stale one');
    // The premise: health asked ps when, or how long ago, the process started.
    const asked = (await box.ps.calls()).some(({ args }) => [PS_ELAPSED, PS_START].some((shape) => JSON.stringify(args) === JSON.stringify([...shape, String(live)])));
    assert.ok(asked, 'health asks ps -o etime= -p <pid> for the harness');
  });
}

for (const [label, env] of [
  ['with TZ set to another zone', { TZ: 'Asia/Tokyo' }],
  ['with LC_ALL set to another locale', { LC_ALL: 'de_DE.UTF-8' }],
]) {
  test(`RH1a the kit run ${label}: the live entry still counts and the stale one does not`, async (t) => {
    // The real ps prints lstart in the zone TZ sets, with the names of the
    // locale LC_ALL sets; the fake does too (helpers/fake-ps.js). Claude Code
    // writes procStart with TZ=UTC and LC_ALL=C.
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const live = await livePidOf(box, bots, BOT, 'daily');
    await registered(box, bots, BRIDGE, { procStart: await staleStartOf(box, live) });
    await registered(box, bots, null, { configDir: profileHome(box) });

    assert.equal((await stateOf(box, { env })).state, 'not enabled');
  });
}

/** A zone ahead of UTC and one behind it, each with another locale for every locale setting. */
const ELSEWHERE = [
  ['in Asia/Shanghai and fr_FR.UTF-8', { TZ: 'Asia/Shanghai', LC_ALL: 'fr_FR.UTF-8', LANG: 'fr_FR.UTF-8', LC_TIME: 'fr_FR.UTF-8' }],
  ['in America/New_York and de_DE.UTF-8', { TZ: 'America/New_York', LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8', LC_TIME: 'de_DE.UTF-8' }],
];

for (const [label, env] of ELSEWHERE) {
  test(`RH1a the kit run ${label}: the live entry, not enabled, counts and a stale enabled one minutes older does not`, async (t) => {
    // procStart is UTC and C-locale text, whatever zone and locale the kit runs in.
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const live = await livePidOf(box, bots, BOT, 'daily');
    const start = await startedAgo(box, live, 40 * 60_000);
    await registered(box, bots, BRIDGE, { procStart: lstartOf(start - 5 * 60_000) });
    await registered(box, bots, null, { configDir: profileHome(box), procStart: lstartOf(start) });

    const { answer } = await health(box, { env });

    assert.deepEqual(sessionOf(answer).remote_control, { asked: 'on', from: 'kit default', state: 'not enabled' });
    const found = remoteFindings(answer);
    assert.equal(found.length, 1, `one finding about Remote Control, got: ${JSON.stringify(answer.found, null, 2)}`);
    assert.ok(found[0].says.includes(`Remote Control is not on for ${BOT}'s session daily`), `got: ${found[0].says}`);
  });

  test(`RH1a the kit run ${label}: the live entry, enabled, counts and a stale not-enabled one minutes older does not`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const live = await livePidOf(box, bots, BOT, 'daily');
    const start = await startedAgo(box, live, 40 * 60_000);
    await registered(box, bots, null, { procStart: lstartOf(start - 5 * 60_000) });
    await registered(box, bots, BRIDGE, { configDir: profileHome(box), procStart: lstartOf(start) });

    const { answer } = await health(box, { env });

    assert.deepEqual(sessionOf(answer).remote_control, { asked: 'on', from: 'kit default', state: 'enabled' });
    assert.deepEqual(remoteFindings(answer), []);
  });
}

for (const [label, written] of [
  ['two blanks before a one-digit day, as ps prints it', 'Sun Nov  1 20:27:58 2026'],
  ['one blank before a one-digit day, where ps prints two', 'Sun Nov 1 20:27:58 2026'],
  ['blanks at both ends and two between words', '  Sun  Nov  1 20:27:58  2026 '],
]) {
  test(`RH1a procStart is read with runs of blanks as one and the ends trimmed: ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const live = await livePidOf(box, bots, BOT, 'daily');
    // Sun Nov 1 2026, 20:27:58 UTC, in the past: ps prints lstart `Sun Nov  1 20:27:58 2026`.
    await box.orca.set({ psStarts: { [live]: Date.UTC(2026, 10, 1, 20, 27, 58) } });
    await registered(box, bots, null, { procStart: 'Sun Nov  1 20:26:58 2026' });
    await registered(box, bots, BRIDGE, { configDir: profileHome(box), procStart: written });

    assert.equal((await stateOf(box)).state, 'enabled', 'the first entry is a minute off and stale; the second is the live one');
  });
}

// The kit's start is now minus an elapsed time truncated to a second, and
// procStart is truncated to a second too: the live entry must count at any
// point in its second, at every length of elapsed time ps prints
// (`mm:ss`, `hh:mm:ss`, `dd-hh:mm:ss`), and one a minute off must not.
for (const [label, ago] of [
  ['3 seconds', 3_000],
  ['5 minutes', 5 * 60_000],
  ['2 hours', 2 * 3600_000 + 5 * 60_000],
  ['3 days', 3 * 86400_000 + 3600_000],
  ['120 days', 120 * 86400_000],
]) {
  test(`RH1a a live process started ${label} ago, late in its second: its entry counts, and one a minute older under the same pid does not`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const live = await livePidOf(box, bots, BOT, 'daily');
    const start = await startedAgo(box, live, ago, { late: true });
    await registered(box, bots, BRIDGE, { procStart: lstartOf(start - 60_000) });
    await registered(box, bots, null, { configDir: profileHome(box), procStart: lstartOf(start) });

    assert.equal((await stateOf(box)).state, 'not enabled', 'the first entry is a minute older and stale; the second is the live one');
  });
}

for (const [label, off] of [['a minute earlier', -60_000], ['a minute later', 60_000]]) {
  test(`RH1a an entry whose procStart is ${label} than the live process's start, alone: unknown, with a why, and no finding`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const live = await livePidOf(box, bots, BOT, 'daily');
    const start = await startedAgo(box, live, 10 * 60_000);
    await registered(box, bots, null, { procStart: lstartOf(start + off) });

    const { answer } = await health(box);

    assertUnknown(sessionOf(answer).remote_control);
    assert.deepEqual(remoteFindings(answer), []);
  });
}

// A procStart that is not a readable time is not this process's start.
for (const [label, written] of [
  ['garbage text', () => 'not a time at all'],
  ['an empty string', () => ''],
  ['a number: the start in ms', (start) => start],
  ['an object', (start) => ({ at: lstartOf(start) })],
  ['a boolean', () => true],
]) {
  test(`RH1a an entry whose procStart is ${label} is skipped: the live one after it counts`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const live = await livePidOf(box, bots, BOT, 'daily');
    const start = await startedAgo(box, live, 10 * 60_000);
    await registered(box, bots, BRIDGE, { procStart: written(start) });
    await registered(box, bots, null, { configDir: profileHome(box), procStart: lstartOf(start) });

    assert.equal((await stateOf(box)).state, 'not enabled');
  });

  test(`RH1a an entry whose procStart is ${label}, alone: unknown, with a why, and no finding`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const live = await livePidOf(box, bots, BOT, 'daily');
    const start = await startedAgo(box, live, 10 * 60_000);
    await registered(box, bots, null, { procStart: written(start) });

    const { answer } = await health(box);

    assertUnknown(sessionOf(answer).remote_control);
    assert.deepEqual(remoteFindings(answer), []);
  });
}

// ------------------------------------------------------------- RH4 the text

/** The plain line health gives one session: the one that names `<bot> <session>` and the session's settings. */
function lineOf(stdout, name) {
  const lines = stdout.split('\n').filter((line) => /^(running|unsure) /.test(line) && line.includes(`${BOT} ${name}`));
  assert.equal(lines.length, 1, `one line for ${BOT} ${name}, got:\n${stdout}`);
  return lines[0];
}

for (const [label, keys, bridge, end] of [
  ['enabled, asked on', {}, BRIDGE, '  remote control enabled (asked on)'],
  ['not enabled, asked on', {}, null, '  remote control not enabled (asked on)'],
  ['not enabled, asked off', { remote_control: 'off' }, ABSENT, '  remote control not enabled (asked off)'],
  ['enabled, asked off', { remote_control: 'off' }, BRIDGE, '  remote control enabled (asked off)'],
]) {
  test(`RH4 the session's line ends with the state: ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, { keys });
    await registered(box, bots, bridge);

    const { stdout } = await health(box, { json: false });

    assert.ok(lineOf(stdout, 'daily').endsWith(end), `the line should end with ${JSON.stringify(end)}, got: ${lineOf(stdout, 'daily')}`);
  });
}

test('RH4 an unknown state ends the line too, and a Codex session\'s line says nothing of Remote Control', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box, { codex: true });

  const { stdout } = await health(box, { json: false });

  assert.ok(lineOf(stdout, 'daily').endsWith('  remote control unknown (asked on)'), `got: ${lineOf(stdout, 'daily')}`);
  assert.doesNotMatch(lineOf(stdout, 'review'), /remote control/i);
});

// ------------------------------------------------------------- RH5 the findings

test('RH5 asked on and not enabled: a session finding says Remote Control is not on for it, and that its tab says why', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await registered(box, bots, null);

  const { answer, code } = await health(box);

  const found = remoteFindings(answer);
  assert.equal(found.length, 1, `one finding about Remote Control, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.equal(found[0].kind, 'session');
  assert.ok(found[0].says.includes(`Remote Control is not on for ${BOT}'s session daily`), `got: ${found[0].says}`);
  assert.ok(found[0].says.includes('Its tab says why'), `got: ${found[0].says}`);
  assert.equal(code, 1, 'a finding makes health exit 1');
});

test('RH5 asked on and no bridgeSessionId key at all: the same finding', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await registered(box, bots, ABSENT);

  const { answer } = await health(box);

  const found = remoteFindings(answer);
  assert.equal(found.length, 1, `got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.ok(found[0].says.includes(`Remote Control is not on for ${BOT}'s session daily`), `got: ${found[0].says}`);
});

test('RH5 asked off and enabled: a session finding names the cold restore, obk restart, and the hard off in .claude/settings.local.json', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { keys: { remote_control: 'off' } });
  await registered(box, bots, BRIDGE);

  const { answer } = await health(box);

  const found = remoteFindings(answer);
  assert.equal(found.length, 1, `one finding about Remote Control, got: ${JSON.stringify(answer.found, null, 2)}`);
  const { kind, says } = found[0];
  assert.equal(kind, 'session');
  assert.ok(says.includes(`${BOT}'s session daily is set off, but Remote Control is enabled in it`), `got: ${says}`);
  assert.match(says, /cold restore/i, `it names the cold restore, got: ${says}`);
  assert.match(says, /\brestart\b/, `it names obk restart, got: ${says}`);
  assert.ok(says.includes('"disableRemoteControl": true'), `it names the hard off, got: ${says}`);
  assert.ok(says.includes(path.join('.claude', 'settings.local.json')), `it names where the hard off goes, got: ${says}`);
});

for (const [label, keys, bridge] of [
  ['asked on and enabled', {}, BRIDGE],
  ['asked off and not enabled', { remote_control: 'off' }, null],
  ['asked off with no bridgeSessionId key', { remote_control: 'off' }, ABSENT],
  ['asked on and unknown: a number', {}, 7],
  ['asked off and unknown: an empty string', { remote_control: 'off' }, ''],
]) {
  test(`RH5 ${label}: no finding about Remote Control`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, { keys });
    await registered(box, bots, bridge);

    const { answer } = await health(box);

    assert.deepEqual(remoteFindings(answer), []);
    assert.ok(sessionOf(answer).remote_control, 'the premise: health judged daily');
  });
}

test('RH5 no entry at all: unknown, and no finding about Remote Control', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  const { answer } = await health(box);

  assert.deepEqual(remoteFindings(answer), []);
  assert.equal(sessionOf(answer).remote_control?.state, 'unknown');
});

test('RH5 asked off and enabled, with its own --settings in extra_args: the finding names its own --settings and the hard off, and does not give obk restart as the way to turn it off', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { keys: { remote_control: 'off', extra_args: ['--settings', 'my-settings.json'] } });
  await registered(box, bots, BRIDGE);

  const { answer } = await health(box);

  const found = remoteFindings(answer).filter((one) => one.kind === 'session');
  assert.equal(found.length, 1, `one session finding about Remote Control, got: ${JSON.stringify(answer.found, null, 2)}`);
  const { says } = found[0];
  assert.ok(says.includes(`${BOT}'s session daily is set off, but Remote Control is enabled in it`), `got: ${says}`);
  assert.ok(says.includes('--settings'), `it names its own --settings as the reason, got: ${says}`);
  assert.ok(says.includes('"disableRemoteControl": true'), `it names the hard off, got: ${says}`);
  assert.ok(says.includes(path.join('.claude', 'settings.local.json')), `it names where the hard off goes, got: ${says}`);
  assert.doesNotMatch(says, / restart --bots /, `a restart still sends its own --settings, so it is not the way to turn it off, got: ${says}`);
  assert.doesNotMatch(says, /connected/i, `got: ${says}`);
});

// ------------------------------------------------------------- RH6 a hand-written --remote-control or --rc

for (const [label, extra, keys] of [
  ['--remote-control', ['--remote-control'], {}],
  ['--remote-control=<name>', ['--remote-control=my-title'], {}],
  ['--rc', ['--rc'], {}],
  ['--rc=<name>', ['--rc=my-title'], {}],
  ['--rc in a string of shell text', '--verbose --rc', {}],
  ['--rc on a session set off', ['--rc'], { remote_control: 'off' }],
]) {
  test(`RH6 a hand-written ${label} in extra_args is a config finding that names the session and --remote-control on|off, with no harness running`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box, { keys: { ...keys, extra_args: extra }, up: false });

    const { answer } = await health(box);

    const found = (answer.found ?? []).filter((one) => one.kind === 'config' && (one.says ?? '').includes('--remote-control on|off'));
    assert.equal(found.length, 1, `one config finding, got: ${JSON.stringify(answer.found, null, 2)}`);
    assert.ok(found[0].says.includes(`${BOT}'s session daily`), `got: ${found[0].says}`);
  });
}

test('RH6 --remote-control-session-name-prefix in extra_args is not --remote-control: no finding', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box, { keys: { extra_args: ['--remote-control-session-name-prefix', 'fleet'] }, up: false });

  const { answer } = await health(box);

  assert.deepEqual((answer.found ?? []).filter((one) => (one.says ?? '').includes('--remote-control on|off')), []);
});

// ------------------------------------------------------------- RH6a its own --settings on a session set off

/** The config findings that say a session carries its own --settings. */
const ownSettingsFindings = (answer) => (answer.found ?? []).filter((one) => (one.says ?? '').includes('carries its own --settings in'));

/** Write `keys` into the entry of the session `name` in api-bot's bot.yaml. */
async function withKeys(bots, name, keys) {
  const file = botYamlOf(bots, BOT);
  const doc = parse(await readFile(file, 'utf8'));
  doc.sessions = doc.sessions.map((one) => (one.name === name ? { ...one, ...keys } : one));
  await writeFile(file, stringify(doc));
}

for (const [label, extra] of [
  ['--settings and its value as two words', ['--settings', 'my-settings.json']],
  ['--settings=<file>', ['--settings=my-settings.json']],
  ['--settings in a string of shell text', '--verbose --settings my-settings.json'],
]) {
  test(`RH6a a session set off with its own ${label} in extra_args: a config finding says it runs without Remote Control off, with no harness running`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box, { keys: { remote_control: 'off', extra_args: extra }, up: false });

    const { answer } = await health(box);

    const found = ownSettingsFindings(answer);
    assert.equal(found.length, 1, `one finding, got: ${JSON.stringify(answer.found, null, 2)}`);
    const { kind, says } = found[0];
    assert.equal(kind, 'config');
    assert.match(says, new RegExp(`^${BOT}'s session daily carries its own --settings in \\S*bot\\.yaml, which replaces the kit's`), `got: ${says}`);
    assert.ok(says.includes('Remote Control off'), `it lists Remote Control off as what it runs without, got: ${says}`);
    assert.ok(says.includes('take --settings out of its extra_args'), `got: ${says}`);
    assert.doesNotMatch(says, /connected/i, `got: ${says}`);
  });
}

test('RH6a only the session set off names Remote Control off: a session set on with its own --settings names the memory folder alone, and one set off without gets none', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { keys: { remote_control: 'off', extra_args: ['--settings', 'my-settings.json'] }, up: false });
  for (const name of ['night', 'plain']) await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name]);
  await withKeys(bots, 'night', { remote_control: 'on', extra_args: ['--settings', 'my-settings.json'] });
  await withKeys(bots, 'plain', { remote_control: 'off' });

  const { answer } = await health(box);

  const found = ownSettingsFindings(answer);
  const of = (name) => found.filter((one) => one.says.startsWith(`${BOT}'s session ${name} `));
  assert.equal(found.length, 2, `two findings, for daily and night, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.equal(of('daily').length, 1, `one for daily, got: ${JSON.stringify(found, null, 2)}`);
  assert.equal(of('night').length, 1, `one for night, got: ${JSON.stringify(found, null, 2)}`);
  assert.equal(of('plain').length, 0, `none for plain, which is off with no --settings of its own, got: ${JSON.stringify(found, null, 2)}`);
  assert.match(
    of('daily')[0].says,
    /, so it runs without: its bot's own memory folder, Remote Control off\. To give it back, take --settings out of its extra_args\.$/,
    'daily is set off, so it runs without the memory folder and without Remote Control off',
  );
  assert.match(
    of('night')[0].says,
    /, so it runs without: its bot's own memory folder\. To give it back, take --settings out of its extra_args\.$/,
    'night is set on, so it runs without the memory folder alone',
  );
  assert.ok(!of('night')[0].says.includes('Remote Control'), `night's finding says nothing of Remote Control, got: ${of('night')[0].says}`);
});

// ------------------------------------------------------------- RH7 never "connected"

for (const [label, keys, bridge] of [
  ['enabled, asked on', {}, BRIDGE],
  ['not enabled, asked on', {}, null],
  ['enabled, asked off', { remote_control: 'off' }, BRIDGE],
  ['unknown', {}, 42],
]) {
  test(`RH7 health never says connected about Remote Control: ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, { keys });
    await registered(box, bots, bridge);

    const plain = await health(box, { json: false });
    const { answer } = await health(box);

    const lines = plain.stdout.split('\n');
    const about = lines.filter((line, at) => /remote control/i.test(line) || /remote control/i.test(lines[at - 1] ?? ''));
    assert.ok(about.length > 0, `the premise: health says something about Remote Control, got:\n${plain.stdout}`);
    for (const line of about) assert.doesNotMatch(line, /connected/i, `got: ${line}`);
    for (const one of remoteFindings(answer)) assert.doesNotMatch(one.says, /connected/i, `got: ${one.says}`);
    assert.doesNotMatch(JSON.stringify(sessionOf(answer).remote_control), /connected/i);
  });
}

// So the premise of every entry above holds: the registry file the helper writes is the one the kit reads.
test('RH0 the premise: the registry entry is written as <pid>.json, with the pid of the harness in daily\'s tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const pid = await registered(box, bots, BRIDGE);

  const written = JSON.parse(await readFile(path.join(defaultConfigDir(box), 'sessions', `${pid}.json`), 'utf8'));

  assert.equal(written.pid, pid);
  assert.equal(written.bridgeSessionId, BRIDGE);
  // And its procStart is what ps answers for that process, read as Claude Code
  // reads it when it writes procStart: lstart, with TZ=UTC and LC_ALL=C.
  const read = spawnSync(box.ps.cli, ['-o', 'lstart=', '-p', String(pid)], { env: { ...box.env, TZ: 'UTC', LC_ALL: 'C' }, encoding: 'utf8' });
  assert.equal(read.status, 0, read.stderr);
  assert.equal(read.stdout.trim().replace(/\s+/g, ' '), written.procStart.trim().replace(/\s+/g, ' '));
});
