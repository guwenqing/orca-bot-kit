// The native road only to a receiver the sender's harness lists (#700).
//
// Claude Code's SendMessage reaches only a session listed in the sender's own
// registry of live sessions: `<config dir>/sessions/<pid>.json`, the config
// dir being `$CLAUDE_CONFIG_DIR` when it is set and not empty, and
// `$HOME/.claude` otherwise. Orca starts some Claude tabs with a config dir of
// its own, so two sessions can sit in two registries. Then SendMessage answers
// "No agent named '<address>' is reachable.", and `obk message send` refused
// the mailbox for the same pair: the sender had no road at all (#700).
//
// The requirement, as the tests below check it:
//
//   R1  For a Claude sender and a Claude receiver in one approval class, whose
//       book holds a kit-given address, `obk message to` answers `native` at
//       that address only when the sender's registry, read from the
//       environment of the `obk` process, holds an entry whose `name` is
//       exactly that address and whose `pid` is live: the kit's read of one
//       process (`ps -o pid=,ppid=,tpgid=,comm= -p <pid>`) answers for it,
//       which in the sandbox is the fake ps (helpers/fake-ps.js).
//   R2  Otherwise that pair takes the Orca mailbox: `transport: "orca"`,
//       `address: "run:<the receiver's mailbox>"`, and `unlisted: true`. The
//       plain answer names `message send … --to <bot>/<session>` and says the
//       receiver is not among the sessions the sender's harness lists.
//   R3  `obk message send` follows the same road: an unlisted receiver of
//       such a pair is sent to through the mailbox; a listed live one is still
//       refused, and nothing is posted.
//   R4  Nothing else changes: Codex at either end, a mixed-approval pair and
//       a receiver with no kit-given address answer as before, with no
//       `unlisted`, whatever the registry holds.
//   R5  (in session-sent.test.js) `obk session sent` names the road `message
//       to` gives, so it follows R1 and R2 too.
//
// Every registry here is in the sandbox: under its own HOME, or under a
// folder of the sandbox named by CLAUDE_CONFIG_DIR (helpers/claude-registry.js).

import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';

import { bookIn, bookOf, createSandbox, orcaCallsOf, sessionIn } from './helpers/cli.js';
import { defaultConfigDir, listInRegistry, listSession, livePidOf, registryIn } from './helpers/claude-registry.js';
import { addSession } from './helpers/permissions.js';

/** A bots folder holding `fleet`, each bot with one session, `daily`, all brought up. */
async function fleetIn(box, fleet) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness, settings = []] of fleet) {
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    assert.equal(made.code, 0, made.stderr);
    // #527: an approval goes through `obk permission approval`, after session add.
    const added = await addSession(box, { bot, name: 'daily', settings });
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

const AUTO = ['--approval', 'auto'];
const ASK = ['--approval', 'ask'];
const SKIP = ['--approval', 'dangerously-skip'];

/** Two auto Claude bots: the pair the tests below use unless they say otherwise. */
const TWO_AUTO = [['auto-one', 'claude', AUTO], ['auto-two', 'claude', AUTO]];

/** `obk message to --json` from `from` to `to`, parsed. `env` is the environment of the obk process. */
async function askTo(box, to, from, { env } = {}) {
  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', to, '--from', from, '--json'], { env });
  assert.equal(result.code, 0, `obk message to: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** The part of an answer that says the road: transport, address, and the `unlisted` flag. */
const roadOf = ({ transport, address, unlisted }) => ({ transport, address, unlisted });

/** The answer for a receiver the sender's harness lists: the native road, at its address. */
const nativeAt = (address) => ({ transport: 'native', address, unlisted: undefined });

/** The answer for a receiver it does not list: the receiver's mailbox, said to be unlisted. */
const mailboxOf = async (bots, bot) => ({ transport: 'orca', address: `run:${(await sessionIn(bots, bot, 'daily')).mailbox}`, unlisted: true });

// ------------------------------------------------------------- R1 and R2: message to

/** The three ways two Claude sessions share an approval class. */
const SAME_CLASS = [
  ['two auto Claude sessions', [['auto-one', 'claude', AUTO], ['auto-two', 'claude', AUTO]], 'auto-one', 'auto-two'],
  ['an auto and an ask Claude session, both prompting', [['auto-one', 'claude', AUTO], ['ask-bot', 'claude', ASK]], 'auto-one', 'ask-bot'],
  ['two dangerously-skip Claude sessions, both bypassing', [['skip-one', 'claude', SKIP], ['skip-two', 'claude', SKIP]], 'skip-one', 'skip-two'],
];

for (const [label, fleet, from, to] of SAME_CLASS) {
  test(`R1 R2 ${label}: the mailbox while the receiver is not in the sender's registry, native once it is listed live`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, fleet);
    const { address } = await sessionIn(bots, to, 'daily');

    // No registry folder at all: SendMessage could not reach the receiver.
    assert.deepEqual(
      roadOf(await askTo(box, to, `${from}/daily`)),
      await mailboxOf(bots, to),
      `with no registry in ${defaultConfigDir(box)}, ${to}/daily is not listed, so the road is its mailbox`,
    );

    await listSession(box, bots, to);
    assert.deepEqual(
      roadOf(await askTo(box, to, `${from}/daily`)),
      nativeAt(address),
      `listed live in ${registryIn(defaultConfigDir(box))}, the road is native, at ${address}`,
    );
  });
}

test('R2 the plain answer for an unlisted receiver names the mailbox send and says the sender\'s harness does not list it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, TWO_AUTO);
  const { mailbox } = await sessionIn(bots, 'auto-two', 'daily');

  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', 'auto-two', '--from', 'auto-one/daily']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const [transport, where, address] = result.stdout.split('\n')[0].trim().split(/\s+/);
  assert.deepEqual({ transport, where, address }, { transport: 'orca', where: 'auto-two/daily', address: `run:${mailbox}` },
    `the first line is the mailbox road, got:\n${result.stdout}`);
  assert.match(result.stdout, /\bmessage send\b[^\n]*--to auto-two\/daily\b/, `it names the send that carries it, got:\n${result.stdout}`);
  assert.match(result.stdout, /\bnot\b[^.\n]*\blist/i, `it says the receiver is not among the sessions the sender's harness lists, got:\n${result.stdout}`);
});

test('R2 an unlisted receiver has a kit-given name, so the answer does not call it unnamed', async (t) => {
  // `unnamed` says the receiver runs under no name the kit gave it (#286), which
  // is not so here: its book holds its address, and only the registry lacks it.
  const box = await createSandbox(t);
  await fleetIn(box, TWO_AUTO);

  const answer = await askTo(box, 'auto-two', 'auto-one/daily');

  assert.equal(answer.unlisted, true, `the premise: the receiver is unlisted, got: ${JSON.stringify(answer)}`);
  assert.notEqual(answer.unnamed, true, `got: ${JSON.stringify(answer)}`);
});

/**
 * The ways a registry can fail to list the receiver, each written into the
 * sandbox's `$HOME/.claude/sessions` by `arrange(box, bots, receiver)`, where
 * `receiver` is `{ address, pid }`: its address and its harness's live pid.
 */
const NOT_LISTED = [
  ['an empty registry folder', async (box) => {
    await mkdir(registryIn(defaultConfigDir(box)), { recursive: true });
  }],
  ['entries for other sessions only: the sender itself, live', async (box, bots) => {
    await listSession(box, bots, 'auto-one');
  }],
  ['an entry whose name is the receiver\'s bare <bot>.<session>', async (box, bots, receiver) => {
    await listInRegistry(box, 'auto-two.daily', { pid: receiver.pid });
  }],
  ['an entry whose name is the receiver\'s address with more after it', async (box, bots, receiver) => {
    await listInRegistry(box, `${receiver.address}x`, { pid: receiver.pid });
  }],
  ['an entry whose name is the receiver\'s address in capitals', async (box, bots, receiver) => {
    await listInRegistry(box, receiver.address.toUpperCase(), { pid: receiver.pid });
  }],
  ['an entry with the receiver\'s address and a pid that is not live: the test runner\'s own, live on the machine but not in the sandbox\'s process table', async (box, bots, receiver) => {
    await listInRegistry(box, receiver.address, { pid: process.pid });
  }],
  ['an entry with the receiver\'s address and a pid no process has', async (box, bots, receiver) => {
    await listInRegistry(box, receiver.address, { pid: 49992 });
  }],
  ['an entry with the receiver\'s address and no pid', async (box, bots, receiver) => {
    await listInRegistry(box, receiver.address, { pid: receiver.pid, entry: { name: receiver.address, status: 'busy' } });
  }],
  ['an entry with the receiver\'s pid and no name', async (box, bots, receiver) => {
    await listInRegistry(box, receiver.address, { pid: receiver.pid, entry: { pid: receiver.pid, status: 'busy' } });
  }],
  ['a file of the receiver\'s pid that is not valid JSON', async (box, bots, receiver) => {
    await listInRegistry(box, receiver.address, { pid: receiver.pid, entry: `{"pid": ${receiver.pid}, "name": "${receiver.address}"` });
  }],
];

for (const [label, arrange] of NOT_LISTED) {
  test(`R1 R2 a registry holding ${label} does not list the receiver: the mailbox`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, TWO_AUTO);
    const pid = await livePidOf(box, bots, 'auto-two');
    const { address } = await sessionIn(bots, 'auto-two', 'daily');
    await arrange(box, bots, { address, pid });

    assert.deepEqual(
      roadOf(await askTo(box, 'auto-two', 'auto-one/daily')),
      await mailboxOf(bots, 'auto-two'),
      `${label} in ${registryIn(defaultConfigDir(box))}: auto-two/daily (${address}, pid ${pid}) is not listed live`,
    );
  });
}

test('R1 files the kit cannot read are passed over, and the receiver\'s good entry beside them still lists it', async (t) => {
  // The first half fails as the mailbox: every file there is broken or about
  // someone else. The second adds the receiver's entry, and the broken files
  // stay where they are.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, TWO_AUTO);
  const { address } = await sessionIn(bots, 'auto-two', 'daily');
  const pid = await livePidOf(box, bots, 'auto-two');
  const dir = registryIn(defaultConfigDir(box));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '1.json'), '{ this is not JSON\n');
  await writeFile(path.join(dir, '2.json'), `${JSON.stringify({ pid, status: 'idle' })}\n`);
  await writeFile(path.join(dir, '3.json'), `${JSON.stringify({ name: address, status: 'idle' })}\n`);
  await writeFile(path.join(dir, '4.json'), 'null\n');
  await writeFile(path.join(dir, '5.json'), '[1, 2, 3]\n');
  await writeFile(path.join(dir, '6.json'), '');
  await writeFile(path.join(dir, '7.json'), `${JSON.stringify({ pid, name: 'auto-one.daily.k3x9q2m7' })}\n`);
  await chmod(path.join(dir, '7.json'), 0o000);
  await writeFile(path.join(dir, `${pid}.3f9a1c2b.key`), 'not-json-key-material\n');
  await mkdir(path.join(dir, 'a-folder.json'));

  assert.deepEqual(roadOf(await askTo(box, 'auto-two', 'auto-one/daily')), await mailboxOf(bots, 'auto-two'),
    'the premise: none of those files lists the receiver');

  await listInRegistry(box, address, { pid, file: '9.json' });

  assert.deepEqual(roadOf(await askTo(box, 'auto-two', 'auto-one/daily')), nativeAt(address),
    'its good entry is read, whatever the files beside it hold');
});

/**
 * Files beside the entries that are not entries: only `<pid>.json` is one.
 * Each name below holds a whole, valid entry for the receiver with its live
 * pid, so a kit that read it would list the receiver (#702 review).
 */
const NOT_ENTRIES = [
  ['Claude Code\'s <pid>.<hex>.key', (pid) => `${pid}.3f9a1c2b.key`],
  ['a <pid>.json.bak', (pid) => `${pid}.json.bak`],
  ['a <pid>.json~', (pid) => `${pid}.json~`],
  ['a <pid> with no extension', (pid) => `${pid}`],
];

for (const [label, nameOf] of NOT_ENTRIES) {
  test(`R1 R2 only .json files are entries: the receiver named in ${label} alone is not listed, and the same JSON as <pid>.json is`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, TWO_AUTO);
    const { address } = await sessionIn(bots, 'auto-two', 'daily');
    const pid = await livePidOf(box, bots, 'auto-two');
    const file = nameOf(pid);
    await listInRegistry(box, address, { pid, file });

    assert.deepEqual(roadOf(await askTo(box, 'auto-two', 'auto-one/daily')), await mailboxOf(bots, 'auto-two'),
      `${file} in ${registryIn(defaultConfigDir(box))} holds a valid entry for ${address}, pid ${pid}, and is not a .json file, so it lists nobody`);

    await listInRegistry(box, address, { pid, file: `${pid}.json` });
    assert.deepEqual(roadOf(await askTo(box, 'auto-two', 'auto-one/daily')), nativeAt(address),
      `the same entry as ${pid}.json lists the receiver: native`);
  });
}

test('R1 R2 a registry folder the kit cannot read lists nobody: the mailbox, and no crash', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, TWO_AUTO);
  const { file } = await listSession(box, bots, 'auto-two');
  const dir = path.dirname(file);
  await chmod(dir, 0o000);
  let answer;
  try {
    answer = await askTo(box, 'auto-two', 'auto-one/daily');
  } finally {
    // Back, so the sandbox can be cleared away.
    await chmod(dir, 0o755);
  }

  assert.deepEqual(roadOf(answer), await mailboxOf(bots, 'auto-two'),
    `${dir} cannot be read, so it lists nobody: ${JSON.stringify(answer)}`);
});

test('R1 R2 CLAUDE_CONFIG_DIR names the registry: its sessions folder is read, and $HOME/.claude is not', async (t) => {
  // As Orca starts a Claude tab with a profile of its own: the sender's
  // registry is the profile's, and an entry in $HOME/.claude/sessions is in
  // another registry, which SendMessage does not read.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, TWO_AUTO);
  const { address } = await sessionIn(bots, 'auto-two', 'daily');
  const profile = box.path('orca-claude-profile', 'home');
  const other = box.path('another-profile', 'home');
  await mkdir(registryIn(other), { recursive: true });
  await listSession(box, bots, 'auto-two', 'daily', { configDir: profile });

  assert.deepEqual(
    roadOf(await askTo(box, 'auto-two', 'auto-one/daily', { env: { ...box.env, CLAUDE_CONFIG_DIR: profile } })),
    nativeAt(address),
    `listed in ${registryIn(profile)}, which CLAUDE_CONFIG_DIR names: native`,
  );

  await listSession(box, bots, 'auto-two');
  assert.deepEqual(
    roadOf(await askTo(box, 'auto-two', 'auto-one/daily', { env: { ...box.env, CLAUDE_CONFIG_DIR: other } })),
    await mailboxOf(bots, 'auto-two'),
    `listed in ${registryIn(defaultConfigDir(box))} but not in ${registryIn(other)}, which CLAUDE_CONFIG_DIR names: the mailbox`,
  );
});

test('R1 R2 an empty CLAUDE_CONFIG_DIR means $HOME/.claude', async (t) => {
  // Empty is not a folder: it is the variable left unset. A `sessions` folder
  // in the working directory, where an empty path would lead, is not the
  // registry.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, TWO_AUTO);
  const { address } = await sessionIn(bots, 'auto-two', 'daily');
  const env = { ...box.env, CLAUDE_CONFIG_DIR: '' };
  await listSession(box, bots, 'auto-two', 'daily', { configDir: box.cwd });

  assert.deepEqual(roadOf(await askTo(box, 'auto-two', 'auto-one/daily', { env })), await mailboxOf(bots, 'auto-two'),
    `with CLAUDE_CONFIG_DIR empty, ${registryIn(box.cwd)} is not the registry, and ${registryIn(defaultConfigDir(box))} has no entry`);

  await listSession(box, bots, 'auto-two');
  assert.deepEqual(roadOf(await askTo(box, 'auto-two', 'auto-one/daily', { env })), nativeAt(address),
    `with CLAUDE_CONFIG_DIR empty, ${registryIn(defaultConfigDir(box))} is the registry`);
});

// ------------------------------------------------------------------- R4: the rest

test('R4 pairs that took the mailbox still take it, with no unlisted, whatever the registry holds', async (t) => {
  // Each receiver is listed live in the sender's registry, so a kit that took
  // "listed" alone for the native road would answer native here.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [
    ['auto-one', 'claude', AUTO],
    ['auto-two', 'claude', AUTO],
    ['skip-one', 'claude', SKIP],
    ['codex-one', 'codex', AUTO],
  ]);
  // A Codex session's book holds no address, so one of the kit's shape is
  // written for it, to list it under.
  const book = await bookIn(bots, 'codex-one');
  book.sessions.daily.address = 'codex-one.daily.k3x9q2m7';
  await writeFile(bookOf(bots, 'codex-one'), stringify(book));
  for (const bot of ['auto-one', 'auto-two', 'skip-one', 'codex-one']) await listSession(box, bots, bot);

  const run = async (bot) => `run:${(await sessionIn(bots, bot, 'daily')).mailbox}`;
  const cases = [
    ['an auto sender and a dangerously-skip receiver', 'skip-one', 'auto-one/daily'],
    ['a dangerously-skip sender and an auto receiver', 'auto-one', 'skip-one/daily'],
    ['a Claude sender and a Codex receiver', 'codex-one', 'auto-one/daily'],
    ['a Codex sender and a Claude receiver', 'auto-two', 'codex-one/daily'],
  ];
  for (const [label, to, from] of cases) {
    const answer = await askTo(box, to, from);
    assert.deepEqual(roadOf(answer), { transport: 'orca', address: await run(to), unlisted: undefined },
      `${label}: the mailbox, as before, and no unlisted: ${JSON.stringify(answer)}`);
  }
});

test('R4 a Claude receiver with no kit-given address is still unnamed, and not unlisted', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, TWO_AUTO);
  const book = await bookIn(bots, 'auto-two');
  delete book.sessions.daily.address;
  await writeFile(bookOf(bots, 'auto-two'), stringify(book));

  const answer = await askTo(box, 'auto-two', 'auto-one/daily');

  assert.deepEqual(
    { ...roadOf(answer), unnamed: answer.unnamed },
    { transport: 'orca', address: `run:${(await sessionIn(bots, 'auto-two', 'daily')).mailbox}`, unlisted: undefined, unnamed: true },
    `got: ${JSON.stringify(answer)}`,
  );
});

// --------------------------------------------------------------- R3: message send

/** `obk message send --json` from auto-one/daily to auto-two/daily. */
async function sendToTwo(box) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'auto-two', '--from', 'auto-one/daily',
    '--subject', 'about the review', '--text', 'have you started?', '--json',
  ]);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
  return { result, answer };
}

for (const [label, arrange] of [
  ['not in the sender\'s registry', async () => {}],
  ['in the sender\'s registry with a pid that is not live', async (box, bots) => {
    await listInRegistry(box, (await sessionIn(bots, 'auto-two', 'daily')).address, { pid: process.pid });
  }],
]) {
  test(`R3 a Claude receiver of the sender's class ${label} is sent to through its mailbox`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, TWO_AUTO);
    await arrange(box, bots);
    const to = `run:${(await sessionIn(bots, 'auto-two', 'daily')).mailbox}`;
    const from = `run:${(await sessionIn(bots, 'auto-one', 'daily')).mailbox}`;

    const { result, answer } = await sendToTwo(box);

    assert.equal(result.code, 0, `the send should go through, got:\n${result.stdout}${result.stderr}`);
    assert.deepEqual({ sent: answer.sent, transport: answer.transport, address: answer.address }, { sent: true, transport: 'orca', address: to },
      `got: ${JSON.stringify(answer)}`);
    const queued = await box.orca.messages();
    assert.equal(queued.length, 1, `one letter in the fake Orca's mailbox, got: ${JSON.stringify(queued)}`);
    assert.deepEqual({ to: queued[0].to, from: queued[0].from, subject: queued[0].subject }, { to, from, subject: 'about the review' });
    assert.ok(queued[0].body.includes('have you started?'), `the text itself, got: ${queued[0].body}`);
  });
}

test('R3 a Claude receiver of the sender\'s class listed live is still refused, and nothing is posted', async (t) => {
  // A refused native send gets no second road: the mailbox opens only for a
  // receiver the sender's harness cannot list (PRD 6.9, #109).
  const box = await createSandbox(t);
  const bots = await fleetIn(box, TWO_AUTO);
  const { address } = await listSession(box, bots, 'auto-two');

  const { result, answer } = await sendToTwo(box);

  assert.notEqual(result.code, 0, `the send should be refused, got:\n${result.stdout}${result.stderr}`);
  assert.deepEqual({ sent: answer.sent, transport: answer.transport, address: answer.address }, { sent: false, transport: 'native', address },
    `got: ${JSON.stringify(answer)}`);
  assert.deepEqual(orcaCallsOf(await box.orca.calls(), 'orchestration send'), [], 'nothing is sent to Orca');
  assert.deepEqual(await box.orca.messages(), [], 'and nothing is in a mailbox');
});

// ------------------------------------- a process check that cannot answer (#702)

// An entry counts as not live only when the process table answers that its pid
// is not there: in the sandbox, the fake ps exiting 1 for a pid it does not
// know. A check that cannot answer (ps too slow, or ps that does not start)
// says nothing about the pid, so the entry still lists the receiver. Taking it
// as unlisted would open the mailbox to a receiver the sender's harness can
// reach, a second road after a native refusal (PRD 6.9, #109; review of PR
// #702, point 1). How long the kit waits for one check is not part of the
// interface: the slow ps is held back well past 2 s.

/** The ways the fake ps cannot answer, as `orca.set` changes it, after `up`. */
const NO_ANSWER = [
  ['a ps that answers only after 3 s', { psDelayMs: 3000 }],
  ['a ps that does not start (exit 126, as in Codex\'s sandbox)', { ps: 'not-permitted' }],
];

for (const [label, fakePs] of NO_ANSWER) {
  test(`R1 #702 a receiver listed with its live pid, and ${label}: message to still answers native, with no unlisted`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, TWO_AUTO);
    const { address, pid } = await listSession(box, bots, 'auto-two');
    await box.orca.set(fakePs);

    const answer = await askTo(box, 'auto-two', 'auto-one/daily');

    assert.deepEqual(roadOf(answer), nativeAt(address),
      `${address} is listed with pid ${pid}, and ${label} cannot say that pid is gone, so the entry still lists it: ${JSON.stringify(answer)}`);
  });

  test(`R3 #702 a receiver listed with its live pid, and ${label}: message send is refused, and no letter is posted`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, TWO_AUTO);
    const { address, pid } = await listSession(box, bots, 'auto-two');
    await box.orca.set(fakePs);

    const { result, answer } = await sendToTwo(box);

    assert.notEqual(result.code, 0,
      `${address} is listed with pid ${pid}, and ${label} cannot say that pid is gone, so the send should be refused, got:\n${result.stdout}${result.stderr}`);
    assert.deepEqual({ sent: answer.sent, transport: answer.transport, address: answer.address }, { sent: false, transport: 'native', address },
      `got: ${JSON.stringify(answer)}`);
    assert.deepEqual(orcaCallsOf(await box.orca.calls(), 'orchestration send'), [], 'nothing is sent to Orca');
    assert.deepEqual(await box.orca.messages(), [], 'and nothing is in a mailbox');
  });
}

test('R1 R2 #702 the contrast: a receiver listed with a pid the process table says is not there takes the mailbox, and the send carries it', async (t) => {
  // The fake ps as it is, answering at once: exit 1 for a pid it does not
  // know, which is the process table saying the pid is not there.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, TWO_AUTO);
  const { address } = await sessionIn(bots, 'auto-two', 'daily');
  await listInRegistry(box, address, { pid: 49992 });

  assert.deepEqual(roadOf(await askTo(box, 'auto-two', 'auto-one/daily')), await mailboxOf(bots, 'auto-two'),
    `${address} is listed with pid 49992, which the fake ps answers is not there: the mailbox`);

  const { result, answer } = await sendToTwo(box);
  assert.equal(result.code, 0, `the send should go through, got:\n${result.stdout}${result.stderr}`);
  assert.equal(answer.sent, true, `got: ${JSON.stringify(answer)}`);
  assert.equal((await box.orca.messages()).length, 1, 'one letter in the fake Orca\'s mailbox');
});
