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
//        and enabled, or off and not enabled, give none.
//   RH6  A hand-written `--remote-control` or `--rc` in a session's extra_args
//        is a finding of category `config` that names `<bot>'s session <name>`
//        and `--remote-control on|off`. It needs no harness running.
//   RH7  Health never says "connected" about Remote Control: the registry
//        shows a handle, not a connection.
//
// The registry is written into the sandbox's own home (helpers/claude-registry.js),
// and the fake ps gives the harness in a tab the pid 40000 + 10 x terminal + 2
// (helpers/fake-ps.js). Nothing here reads the real ~/.claude or the real Orca.

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { createSandbox } from './helpers/cli.js';
import { defaultConfigDir, listInRegistry, livePidOf } from './helpers/claude-registry.js';
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

/** Claude Code's registry entry for the process `pid`, with `bridge` as its bridgeSessionId, or no such key when it is `absent`. */
const entryFor = (box, pid, bridge) => ({
  pid,
  sessionId: '0199b2c0-0318-4444-8888-aaaaaaaaaaaa',
  cwd: box.cwd,
  startedAt: Date.UTC(2026, 10, 14, 1, 0, 0),
  kind: 'interactive',
  name: `${BOT}.daily.abcd1234`,
  status: 'idle',
  ...(bridge === ABSENT ? {} : { bridgeSessionId: bridge }),
});

const ABSENT = Symbol('absent');

/** Write daily's registry entry into `configDir`'s registry, for the pid of the harness in front of its tab. */
async function registered(box, bots, bridge, { configDir = defaultConfigDir(box), pid } = {}) {
  const live = await livePidOf(box, bots, BOT, 'daily');
  await listInRegistry(box, 'unused', { pid: live, configDir, entry: entryFor(box, pid ?? live, bridge) });
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
  await listInRegistry(box, 'unused', { pid: live + 1000, entry: entryFor(box, live + 1000, BRIDGE) });

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
});
