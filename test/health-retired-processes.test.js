// `obk health` reports what still runs in a retired session's work dir (#537,
// requests/retire-stops-processes/request.md):
//
//   R5  `obk health` reports each process that still runs in the work dir of a
//       retired session, with its pid and its command, so an orphan from
//       before the retire stopped processes is seen too. It reports and stops
//       nothing.
//
// What the request assumes, and these tests hold it to: the book keeps a
// retired session's work dir from now on (`work_dir` on its entry under
// `retired`, tested in retire-stops-processes.test.js); a temporary session
// retired before that has its work dir at `work/<name>`, where `obk temp make`
// always puts it; a long-lived one retired before that has none on record, and
// health does not look for it; and a work dir that a session still in bot.yaml
// uses is not a retired one.
//
// The interface, as the brief gives it: `obk health --json` gains findings
// `{ kind: 'process', bot, where, says }`, one per process, `where` the work
// dir and `says` naming the pid, the command and the retired session; and when
// ps or lsof cannot be read and some retired session's work dir exists, one
// `process` finding that says it cannot tell. Read here: `where` is the work
// dir as an absolute path, resolved against the bot home, as the kit's other
// findings give a folder.
//
// The process table is `processes` in the fake Orca's state.json
// (helpers/fake-ps.js), and the working folders are what the fake lsof gives
// for it (helpers/fake-tty.js). The fake kill (helpers/fake-kill.js) writes
// down any signal and sends none; health must send none at all. The pids are
// made up, from 54000 up.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca, a real
// harness, or anything outside the sandbox.

import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { bookIn, bookOf, botHomeOf, createSandbox } from './helpers/cli.js';

const BOT = 'api-bot';

const homeOf = (box) => botHomeOf(box.path('bots'), BOT);

/** Where a session's work dir is, as `work/<name>` under the bot home resolves. */
const workOf = (box, name) => path.join(homeOf(box), 'work', name);

/** Bot Father, and api-bot with the sessions given as `[name, ...settings]`, brought up, each work dir made. */
async function fleet(box, sessions) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const [name, ...settings] of sessions) {
    await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, ...settings]);
  }
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  for (const [, ...settings] of sessions) {
    const at = settings.indexOf('--work-dir');
    if (at >= 0) await mkdir(path.resolve(homeOf(box), settings[at + 1]), { recursive: true });
  }
  return ok;
}

/** Retire one of api-bot's sessions, which must work. Nothing runs yet, so nothing is stopped. */
async function retired(box, name) {
  const result = await box.run(['retire', '--bots', 'bots', '--bot', BOT, '--session', name]);
  assert.equal(result.code, 0, `obk retire --session ${name}: ${result.stdout}${result.stderr}`);
}

/** Put the fake process table in place, as it is after the retires. */
const table = (box, processes) => box.orca.set({ processes });

/** The health check's `process` findings, from --json. */
async function processFindings(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  assert.equal(result.stderr, '', result.stderr);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`health --json should print JSON, got: ${result.stdout} (${error.message})`);
  }
  return answer.found.filter((finding) => finding.kind === 'process');
}

/** Whether a finding names `pid` as a word of its own. */
const names = (finding, pid) => new RegExp(`\\b${pid}\\b`).test(finding.says);

test('R5 health names a process still running in a retired session\'s work dir, with its pid, its command and the session, and signals nothing', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, [['dev', '--work-dir', 'work/dev']]);
  await retired(box, 'dev');
  const inside = path.join(workOf(box, 'dev'), 'repo');
  await mkdir(inside, { recursive: true });
  await table(box, [
    { pid: 54001, ppid: 1, pgid: 54001, cwd: inside, command: 'node --test test/slow.test.js' },
    { pid: 54002, ppid: 1, pgid: 54002, cwd: path.join(box.home, 'elsewhere'), command: 'sleep 600' },
  ]);

  const found = await processFindings(box);

  assert.equal(found.length, 1, `one process finding, got: ${JSON.stringify(found)}`);
  const [one] = found;
  assert.equal(one.bot, BOT);
  assert.equal(one.where, workOf(box, 'dev'), 'where is the retired session\'s work dir');
  assert.ok(names(one, 54001), `says names the pid: ${one.says}`);
  assert.ok(one.says.includes('node --test test/slow.test.js'), `says names the command: ${one.says}`);
  assert.match(one.says, /\bdev\b/, 'says names the retired session');
  assert.ok(!names(one, 54002), 'and not the process elsewhere');
  assert.deepEqual(await box.kill.calls(), [], 'health signals nothing');
});

test('R5 a temporary session retired before the book kept work dirs is looked for at work/<name>; a long-lived one is not looked for', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, [['daily']]);
  // As a book written before #537 has them: no work_dir on either entry.
  const file = bookOf(box.path('bots'), BOT);
  const book = parse(await readFile(file, 'utf8'));
  book.retired = [
    { name: 'scout', temporary: { maker: 'daily', made: '2026-10-01T09:00:00.000Z' }, retired: '2026-10-01T10:00:00.000Z' },
    { name: 'old', retired: '2026-10-01T11:00:00.000Z' },
  ];
  await writeFile(file, stringify(book));
  for (const name of ['scout', 'old']) await mkdir(workOf(box, name), { recursive: true });
  await table(box, [
    { pid: 54011, ppid: 1, pgid: 54011, cwd: workOf(box, 'scout'), command: 'node --test' },
    { pid: 54012, ppid: 1, pgid: 54012, cwd: workOf(box, 'old'), command: 'sleep 600' },
  ]);

  const found = await processFindings(box);

  assert.deepEqual(found.map((one) => [one.where, names(one, 54011)]), [[workOf(box, 'scout'), true]], `scout's, at work/scout, and nothing for old, got: ${JSON.stringify(found)}`);
  assert.match(found[0].says, /\bscout\b/);
  assert.ok(!found.some((one) => names(one, 54012)));
});

test('R5 a work dir a session still in bot.yaml uses is not a retired one, and a retired one that begins its name does not reach it', async (t) => {
  const box = await createSandbox(t);
  const ok = await fleet(box, [['dev', '--work-dir', 'work/dev'], ['dev-53', '--work-dir', 'work/dev-53'], ['dev-537', '--work-dir', 'work/dev-537']]);
  await retired(box, 'dev');
  await retired(box, 'dev-53');
  assert.equal((await bookIn(box.path('bots'), BOT)).retired?.find((one) => one?.name === 'dev')?.work_dir, 'work/dev', 'the premise: the book has dev\'s work dir');
  // A new session takes the retired one's folder.
  await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'dev-two', '--work-dir', 'work/dev']);
  await table(box, [
    { pid: 54021, ppid: 1, pgid: 54021, cwd: workOf(box, 'dev'), command: 'node --test' },
    { pid: 54022, ppid: 1, pgid: 54022, cwd: workOf(box, 'dev-537'), command: 'sleep 600' },
    { pid: 54023, ppid: 1, pgid: 54023, cwd: workOf(box, 'dev-53'), command: 'sleep 601' },
  ]);

  const found = await processFindings(box);

  assert.deepEqual(found.map((one) => one.where), [workOf(box, 'dev-53')], `dev-53's alone, got: ${JSON.stringify(found)}`);
  assert.ok(names(found[0], 54023), found[0].says);
  assert.ok(!found.some((one) => names(one, 54021) || names(one, 54022)), 'nothing in a folder a live session uses');
});

for (const [what, fault] of [
  ['ps cannot run, as in Codex\'s sandbox', { ps: 'not-permitted' }],
  ['lsof cannot read the working folders', { lsof: 'not-permitted' }],
]) {
  test(`R5 where ${what} and a retired session's work dir exists, health says once that it cannot tell, and signals nothing`, async (t) => {
    const box = await createSandbox(t);
    await fleet(box, [['dev', '--work-dir', 'work/dev'], ['ops', '--work-dir', 'work/ops']]);
    await retired(box, 'dev');
    await retired(box, 'ops');
    await table(box, [{ pid: 54031, ppid: 1, pgid: 54031, cwd: workOf(box, 'dev'), command: 'sleep 600' }]);
    await box.orca.set(fault);

    const found = await processFindings(box);

    assert.equal(found.length, 1, `one process finding for the whole check, got: ${JSON.stringify(found)}`);
    assert.ok(!names(found[0], 54031), 'it names no process, since it could read none');
    assert.notEqual(found[0].says.trim(), '');
    assert.deepEqual(await box.kill.calls(), []);
  });
}

test('R5 with no retired session\'s work dir left on disk, health gives no process finding, even where ps cannot run', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, [['dev', '--work-dir', 'work/dev']]);
  await retired(box, 'dev');
  await rm(workOf(box, 'dev'), { recursive: true, force: true });
  await box.orca.set({ ps: 'not-permitted' });

  assert.deepEqual(await processFindings(box), [], 'nothing to look in, so nothing it cannot tell');

  await mkdir(workOf(box, 'dev'));
  assert.equal((await processFindings(box)).length, 1, 'and with the folder back, the finding is there');
});
