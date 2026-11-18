// The kit reads the process table the same under every locale (#801).
//
// The kit reads the table with `/bin/ps -A -ww -o
// pid=,ppid=,pgid=,uid=,stat=,lstart=,command=`. The real `ps` prints the
// start time (lstart) and the command column in the shape of the locale of the
// environment it runs in, and the kit read only the C shape. Under a German or
// a Chinese locale it read almost no line, so a retire stopped nothing and
// health named nothing, and neither said so.
//
//   W1  The kit reads the process table the same under every locale the kit's
//       own environment has: LC_ALL, LC_TIME, LANG or LC_CTYPE set to a locale
//       that is not English, such as de_DE.UTF-8 or zh_CN.UTF-8. A retire then
//       stops the session's processes, and health reports them, exactly as
//       under the C locale.
//   W2  A command line with text that is not ASCII (`睡觉 4`) shows as the
//       same text in what the kit reports, under a UTF-8 locale, as it does
//       today.
//   W3  When the kit cannot read a line that `ps` gives (any line that is not
//       empty and is not in the expected shape), it says so: the table counts
//       as unreadable. A retire then stops nothing and says it cannot tell
//       (`processes.unreadable` in --json, and the plain `processes` line),
//       and health gives its one "cannot tell" `process` finding. Before
//       #801, a table where some lines did not parse was read as a smaller
//       table, with no word.
//
// The boundary: no new command, option or environment variable for the user.
// The kit asks `ps` the same argv as before. How it gets the C shape (an
// environment of its own for the `ps` child, say) is the developer's: these
// tests check what retire and health report.
//
// The locale is the kit's own environment: each test takes the suite's own
// locale variables out of the sandbox's environment and puts its own in, for
// every run of the kit in that test. The fake ps (helpers/fake-ps.js) prints
// the table in the shape the real `ps` gives for the environment the kit gives
// it, as measured on macOS (#801), so no test here depends on which locales
// this machine has. The fake lsof (helpers/fake-tty.js) and the fake kill
// (helpers/fake-kill.js) are the same in every locale, as the real ones are.
//
// The pids are made up, from 57000 up: no fake tab's (40000 and up) and none
// of the fake lsof's own (1063, 30001, 30002). Nothing here signals or reads a
// real process. Every run is in the sandbox (helpers/cli.js): its own HOME, a
// fake Orca, and fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { bookIn, botHomeOf, createSandbox, kitLaunchMark, sessionIn, tabsOfBot } from './helpers/cli.js';
import { PS_TABLE } from './helpers/fake-ps.js';

const BOT = 'api-bot';

/** A start prompt for a temporary session; short, so it stays in bot.yaml. */
const TASK = 'Read the open pull request and write down what it changes.';

// ------------------------------------------------------------------ the locale

/** The locales the tests run the kit under, each the locale variables of the kit's own environment. */
const C = {};
const GERMAN = { LANG: 'de_DE.UTF-8' };
const CHINESE_ALL = { LC_ALL: 'zh_CN.UTF-8' };

/** Whether an environment variable is one of the locale's. */
const isLocaleVariable = (name) => name === 'LANG' || name.startsWith('LC_');

/** The sandbox's environment without the suite's own locale variables, and with `locale` in their place. */
const withLocale = (env, locale) => ({ ...Object.fromEntries(Object.entries(env).filter(([name]) => !isLocaleVariable(name))), ...locale });

/** From here on, every run of the kit in `box` has `locale` as its locale variables, and no other. */
function useLocale(box, locale) {
  for (const name of Object.keys(box.env)) if (isLocaleVariable(name)) delete box.env[name];
  Object.assign(box.env, locale);
}

/** A locale as a test's name gives it: `LANG=de_DE.UTF-8`, or `the C locale` for none. */
const named = (locale) => (Object.keys(locale).length === 0 ? 'the C locale (no locale variable set)' : Object.entries(locale).map(([name, value]) => `${name}=${value}`).join(' '));

// ------------------------------------------------------------------ the fleet

const botsOf = (box) => box.path('bots');
const homeOf = (box) => botHomeOf(botsOf(box), BOT);

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
}

/** api-bot with one session, dev, whose work dir is work/dev. */
const devFleet = (box) => fleet(box, [['dev', '--work-dir', 'work/dev']]);

/** Put the fake process table in place: `processes` in the fake Orca's state (helpers/fake-ps.js). */
const table = (box, processes) => box.orca.set({ processes });

/** `obk retire --bot api-bot ...`, from outside any tab. */
const retire = (box, rest) => box.run(['retire', '--bots', 'bots', '--bot', BOT, ...rest]);

/** The --json answer of a retire, which finishes and prints JSON and nothing else. */
function answerIn(result) {
  assert.equal(result.code, 0, `the retire should finish, got: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/** The `processes` part of an answer, which must be there, with both lists. */
function processesIn(answer, who = 'the answer') {
  const { processes } = answer;
  assert.equal(typeof processes, 'object', `${who} should carry processes, got: ${JSON.stringify(answer)}`);
  assert.ok(processes !== null && Array.isArray(processes.stopped) && Array.isArray(processes.left), `processes should have stopped and left lists, got: ${JSON.stringify(processes)}`);
  return processes;
}

/** Every kill the kit asked for, as its argv, in order. */
const kills = async (box) => (await box.kill.calls()).map((call) => call.args);

/** The argv of one signal: `term(-57001)` is `-s TERM -- -57001`. */
const term = (target) => ['-s', 'TERM', '--', String(target)];
const kill = (target) => ['-s', 'KILL', '--', String(target)];

/** The argvs sorted, so that a set of signals sent in any order compares. */
const sorted = (calls) => [...calls].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Whether the kit read the whole table, with the argv it has always used. */
const readTheTable = async (box) => (await box.ps.calls()).some((call) => JSON.stringify(call.args) === JSON.stringify(PS_TABLE));

/** The names in api-bot's bot.yaml. */
const namesInBotYaml = async (box) => (parse(await readFile(path.join(homeOf(box), 'bot.yaml'), 'utf8')).sessions ?? []).map((one) => one?.name);

/** One session retired as a retire does it: off bot.yaml and on the book's retired list. */
async function assertRetired(box, name) {
  assert.ok(!(await namesInBotYaml(box)).includes(name), `${name} is off bot.yaml`);
  const book = await bookIn(botsOf(box), BOT);
  assert.equal(book.sessions?.[name], undefined, `${name} is off the book's live list`);
  assert.equal((book.retired ?? []).filter((one) => one?.name === name).length, 1, `${name} is on the book's retired list once, got: ${JSON.stringify(book.retired)}`);
}

/** Retire one of api-bot's sessions while nothing runs, which must work. */
async function retiredFirst(box, name) {
  const result = await retire(box, ['--session', name]);
  assert.equal(result.code, 0, `obk retire --session ${name}: ${result.stdout}${result.stderr}`);
}

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

// ------------------------------------------------------------------ W1, retire

// The first is the control: under the C locale the kit reads the table today.
// The same test under each other locale is W1.
for (const locale of [
  C,
  GERMAN,
  CHINESE_ALL,
  { LC_TIME: 'de_DE.UTF-8' },
  // LC_ALL wins over LC_TIME, as POSIX has it.
  { LC_ALL: 'de_DE.UTF-8', LC_TIME: 'C' },
  { LANG: 'zh_CN.UTF-8', LC_CTYPE: 'zh_CN.UTF-8' },
]) {
  test(`W1 under ${named(locale)}, a retire stops the process in the work dir with TERM to its group, and leaves the one elsewhere, as under the C locale`, async (t) => {
    const box = await createSandbox(t);
    useLocale(box, locale);
    await devFleet(box);
    const inside = path.join(workOf(box, 'dev'), 'repo');
    await mkdir(inside, { recursive: true });
    await table(box, [
      { pid: 57001, ppid: 1, pgid: 57001, cwd: inside, command: 'node --test test/slow.test.js' },
      // Someone else's, in a folder of their own: not dev's by any road.
      { pid: 57002, ppid: 1, pgid: 57002, cwd: path.join(box.home, 'elsewhere'), command: 'sleep 600' },
    ]);

    const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

    const processes = processesIn(answer);
    assert.equal(processes.unreadable, undefined, `the kit reads the table under ${named(locale)}, got: ${JSON.stringify(processes)}`);
    assert.deepEqual(processes.stopped, [
      { session: 'dev', pid: 57001, cwd: inside, command: 'node --test test/slow.test.js', signal: 'SIGTERM' },
    ]);
    assert.deepEqual(processes.left, []);
    assert.deepEqual(await kills(box), [term(-57001)], 'one TERM, to the group of the process in the work dir, and nothing to anyone else');
    assert.ok(await readTheTable(box), 'the premise: the kit read the table with the argv it has always used');
    await assertRetired(box, 'dev');
  });
}

test('W1 under LANG=de_DE.UTF-8, a process that ignores TERM gets KILL by pid after the wait: the reads during the wait work too', async (t) => {
  const box = await createSandbox(t);
  useLocale(box, GERMAN);
  await devFleet(box);
  await table(box, [{ pid: 57011, ppid: 1, pgid: 57011, cwd: workOf(box, 'dev'), command: 'node stubborn.js', ignoresTerm: true }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const processes = processesIn(answer);
  assert.equal(processes.unreadable, undefined, `got: ${JSON.stringify(processes)}`);
  assert.deepEqual(await kills(box), [term(-57011), kill(57011)], 'TERM to the group first, then KILL to the pid');
  assert.deepEqual(processes.stopped.map((one) => [one.pid, one.signal]), [[57011, 'SIGKILL']]);
  assert.deepEqual(processes.left, [], `nothing is left, which it would be if a read during the wait failed, got: ${JSON.stringify(processes.left)}`);
});

// ------------------------------------------------------------------ W1, temp retire

/** The environment of a command a session's harness runs in `terminal`. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** The tab the book gives a session, as Orca has it. */
async function liveTab(box, name) {
  const entry = await sessionIn(botsOf(box), BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, botsOf(box), BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
  return terminal;
}

test('W1 under LANG=de_DE.UTF-8, obk temp retire stops what runs in the temporary session\'s work dir', async (t) => {
  const box = await createSandbox(t);
  useLocale(box, GERMAN);
  await fleet(box, [['lead']]);
  const made = await box.run(['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', TASK], { env: inTab(box, await liveTab(box, 'lead')) });
  assert.equal(made.code, 0, `obk temp make --name scout: ${made.stdout}${made.stderr}`);
  await mkdir(workOf(box, 'scout'), { recursive: true });
  await table(box, [
    { pid: 57021, pgid: 57021, cwd: workOf(box, 'scout'), command: 'node --test test/a.test.js' },
    { pid: 57022, pgid: 57022, cwd: homeOf(box), command: 'sleep 600' },
  ]);

  const result = await box.run(['temp', 'retire', '--bots', 'bots', '--name', 'scout', '--json'], { env: inTab(box, await liveTab(box, 'lead')) });

  const processes = processesIn(answerIn(result));
  assert.equal(processes.unreadable, undefined, `got: ${JSON.stringify(processes)}`);
  assert.deepEqual(processes.stopped.map((one) => [one.session, one.pid, one.signal]), [['scout', 57021, 'SIGTERM']]);
  assert.deepEqual(await kills(box), [term(-57021)], 'and nothing at the bot home, where lead runs');
  await assertRetired(box, 'scout');
});

// ------------------------------------------------------------------ W1, health

for (const locale of [C, GERMAN, CHINESE_ALL]) {
  test(`W1 under ${named(locale)}, health names a process still running in a retired session's work dir, with its pid and command, and signals nothing`, async (t) => {
    const box = await createSandbox(t);
    useLocale(box, locale);
    await devFleet(box);
    await retiredFirst(box, 'dev');
    await table(box, [
      { pid: 57031, ppid: 1, pgid: 57031, cwd: workOf(box, 'dev'), command: 'node --test test/slow.test.js' },
      { pid: 57032, ppid: 1, pgid: 57032, cwd: path.join(box.home, 'elsewhere'), command: 'sleep 600' },
    ]);

    const found = await processFindings(box);

    assert.equal(found.length, 1, `one process finding, got: ${JSON.stringify(found)}`);
    const [one] = found;
    assert.ok(names(one, 57031), `says names the pid, so the kit read the table: ${one.says}`);
    assert.equal(one.where, workOf(box, 'dev'), 'where is the retired session\'s work dir');
    assert.ok(one.says.includes('node --test test/slow.test.js'), `says names the command: ${one.says}`);
    assert.ok(!names(one, 57032), 'and not the process elsewhere');
    assert.deepEqual(await box.kill.calls(), [], 'health signals nothing');
  });
}

// ------------------------------------------------------------------ W2

/** A command line with text that is not ASCII: Chinese for "sleep", and a number. */
const CHINESE_COMMAND = '睡觉 4';

for (const locale of [{ LANG: 'zh_CN.UTF-8' }, { LC_ALL: 'de_DE.UTF-8' }]) {
  test(`W2 under ${named(locale)}, a retire names a command with text that is not ASCII as the same text, in --json and in the plain output`, async (t) => {
    const box = await createSandbox(t);
    useLocale(box, locale);
    await fleet(box, [['dev', '--work-dir', 'work/dev'], ['ops', '--work-dir', 'work/ops']]);
    await table(box, [
      { pid: 57041, ppid: 1, pgid: 57041, cwd: workOf(box, 'dev'), command: CHINESE_COMMAND },
      { pid: 57042, ppid: 1, pgid: 57042, cwd: workOf(box, 'ops'), command: CHINESE_COMMAND },
    ]);

    const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

    const processes = processesIn(answer);
    assert.equal(processes.unreadable, undefined, `got: ${JSON.stringify(processes)}`);
    assert.deepEqual(processes.stopped.map((one) => [one.pid, one.command]), [[57041, CHINESE_COMMAND]], 'the command as it was started, not escaped');

    const plain = await retire(box, ['--session', 'ops']);

    assert.equal(plain.code, 0, `${plain.stdout}${plain.stderr}`);
    const stopped = plain.stdout.split('\n').filter((line) => /^stopped\b/.test(line));
    assert.equal(stopped.length, 1, `one stopped line, got:\n${plain.stdout}`);
    assert.match(stopped[0], /\b57042\b/);
    assert.ok(stopped[0].includes(CHINESE_COMMAND), `the stopped line names the command as it is: ${stopped[0]}`);
  });
}

test('W2 under LANG=zh_CN.UTF-8, health names a command with text that is not ASCII as the same text', async (t) => {
  const box = await createSandbox(t);
  useLocale(box, { LANG: 'zh_CN.UTF-8' });
  await devFleet(box);
  await retiredFirst(box, 'dev');
  await table(box, [{ pid: 57051, ppid: 1, pgid: 57051, cwd: workOf(box, 'dev'), command: CHINESE_COMMAND }]);

  const found = await processFindings(box);

  assert.equal(found.length, 1, `one process finding, got: ${JSON.stringify(found)}`);
  assert.ok(names(found[0], 57051), `says names the pid: ${found[0].says}`);
  assert.ok(found[0].says.includes(CHINESE_COMMAND), `says names the command as it is: ${found[0].says}`);
});

// ------------------------------------------------------------------ W3

// Each a line that is not empty and is not in the shape of the table, in a
// table whose other lines the kit can read.
const UNREADABLE_LINES = [
  ['a line of text', 'ps: the table was busy; this is not a line of it'],
  ['a line whose start time is in the German shape, among lines in the C shape', '57069     1 57069   501 S    Sa. 10 Okt. 08:00:00 2026     sleep 600'],
  ['a line whose pid is not a number', '  pid     1 57068   501 S    Sat Oct 10 08:00:00 2026     sleep 600'],
];

for (const [what, line] of UNREADABLE_LINES) {
  test(`W3 with ${what} in the table, a retire says it cannot tell, signals nothing at all, and still finishes`, async (t) => {
    const box = await createSandbox(t);
    useLocale(box, C);
    await devFleet(box);
    // A process the kit could read, in the work dir: before #801 it was stopped.
    await table(box, [{ pid: 57061, ppid: 1, pgid: 57061, cwd: workOf(box, 'dev'), command: 'sleep 600' }]);
    await box.orca.set({ psTableLines: [line] });

    const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

    const processes = processesIn(answer);
    assert.equal(typeof processes.unreadable, 'string', `the answer says why it cannot tell, got: ${JSON.stringify(processes)}`);
    assert.notEqual(processes.unreadable.trim(), '');
    assert.deepEqual([processes.stopped, processes.left], [[], []]);
    assert.deepEqual(await box.kill.calls(), [], 'no kill is run at all');
    assert.ok(await readTheTable(box), 'the premise: the kit read the table');
    await assertRetired(box, 'dev');
  });
}

test('W3 with a line in the table the kit cannot read, the plain output of a retire says on a processes line that the kit cannot tell, and stops nothing', async (t) => {
  const box = await createSandbox(t);
  useLocale(box, C);
  await devFleet(box);
  await table(box, [{ pid: 57071, ppid: 1, pgid: 57071, cwd: workOf(box, 'dev'), command: 'sleep 600' }]);
  await box.orca.set({ psTableLines: [UNREADABLE_LINES[0][1]] });

  const result = await retire(box, ['--session', 'dev']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const lines = result.stdout.split('\n');
  const said = lines.filter((line) => /^processes\b/.test(line));
  assert.equal(said.length, 1, `one processes line, got:\n${result.stdout}`);
  assert.match(said[0], /can(?:no|')t tell|can not tell/i, `it says the kit cannot tell: ${said[0]}`);
  assert.deepEqual(lines.filter((line) => /^stopped\b/.test(line)), [], 'and no stopped line');
  assert.deepEqual(await box.kill.calls(), []);
});

test('W3 with a line in the table the kit cannot read, health says once that it cannot tell, names no process, and signals nothing', async (t) => {
  const box = await createSandbox(t);
  useLocale(box, C);
  await fleet(box, [['dev', '--work-dir', 'work/dev'], ['ops', '--work-dir', 'work/ops']]);
  await retiredFirst(box, 'dev');
  await retiredFirst(box, 'ops');
  await table(box, [{ pid: 57081, ppid: 1, pgid: 57081, cwd: workOf(box, 'dev'), command: 'sleep 600' }]);
  await box.orca.set({ psTableLines: [UNREADABLE_LINES[0][1]] });

  const found = await processFindings(box);

  assert.equal(found.length, 1, `one process finding for the whole check, got: ${JSON.stringify(found)}`);
  assert.ok(!names(found[0], 57081), `it names no process, since it could not read the table, got: ${found[0].says}`);
  assert.notEqual(found[0].says.trim(), '');
  assert.deepEqual(await box.kill.calls(), []);
});

// ------------------------------------------------------------------ the fake ps, as the real one was measured

/** One read of the whole table from the fake ps, as the kit asks it, under `locale`. */
const tableRead = (box, locale) => spawnSync(box.ps.cli, PS_TABLE, { env: withLocale(box.env, locale), encoding: 'utf8' });

/** The line of `pid` in a table read's output. */
const lineOf = (read, pid) => read.stdout.split('\n').find((line) => new RegExp(`^\\s*${pid}\\s`).test(line));

test('the fake ps prints the table\'s start times in the shape of the effective LC_TIME, by POSIX\'s order, as the real ps was measured (#801)', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({
    processes: [
      { pid: 57091, startedAt: Date.UTC(2026, 10, 17, 18, 38, 9) },
      { pid: 57092, startedAt: Date.UTC(2026, 10, 1, 9, 36, 40) },
    ],
  });
  // The real lines' start times, measured on macOS 27.0.1 (helpers/fake-ps.js).
  for (const [locale, first, second] of [
    [C, 'Tue Nov 17 18:38:09 2026', 'Sun Nov  1 09:36:40 2026'],
    [{ LC_ALL: 'POSIX' }, 'Tue Nov 17 18:38:09 2026', 'Sun Nov  1 09:36:40 2026'],
    [{ LANG: 'en_US.UTF-8' }, 'Tue Nov 17 18:38:09 2026', 'Sun Nov  1 09:36:40 2026'],
    [{ LANG: 'de_DE.UTF-8' }, 'Di. 17 Nov. 18:38:09 2026', 'So.  1 Nov. 09:36:40 2026'],
    [{ LC_ALL: 'zh_CN.UTF-8' }, '二 11月/17 18:38:09 2026', '日 11月/ 1 09:36:40 2026'],
    [{ LC_TIME: 'de_DE.UTF-8' }, 'Di. 17 Nov. 18:38:09 2026', 'So.  1 Nov. 09:36:40 2026'],
    // LC_TIME wins over LANG, LC_ALL over both, and an empty LC_ALL is not set.
    [{ LANG: 'de_DE.UTF-8', LC_TIME: 'C' }, 'Tue Nov 17 18:38:09 2026', 'Sun Nov  1 09:36:40 2026'],
    [{ LC_ALL: 'zh_CN.UTF-8', LC_TIME: 'C', LANG: 'C' }, '二 11月/17 18:38:09 2026', '日 11月/ 1 09:36:40 2026'],
    [{ LC_ALL: '', LC_TIME: 'de_DE.UTF-8' }, 'Di. 17 Nov. 18:38:09 2026', 'So.  1 Nov. 09:36:40 2026'],
    // LC_CTYPE does not change the start time.
    [{ LC_CTYPE: 'zh_CN.UTF-8' }, 'Tue Nov 17 18:38:09 2026', 'Sun Nov  1 09:36:40 2026'],
  ]) {
    const read = tableRead(box, locale);
    assert.equal(read.status, 0, `${named(locale)}: ${read.stderr}`);
    assert.equal(lineOf(read, 57091), `57091     1 57091 ${String(process.getuid()).padStart(5)} S    ${first}     sleep 600`, named(locale));
    assert.ok(lineOf(read, 57092).includes(` S    ${second}     sleep 600`), `${named(locale)}: ${lineOf(read, 57092)}`);
  }

  // A locale with no measurement behind it: the fake says so and gives no table.
  const unknown = tableRead(box, { LANG: 'fr_FR.UTF-8' });
  assert.equal(unknown.status, 70);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /fr_FR\.UTF-8/);
});

test('the fake ps prints the table\'s commands as they are under a UTF-8 LC_CTYPE, and escaped in the style of vis(3) under any other, as the real ps was measured (#801)', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ processes: [{ pid: 57093, command: CHINESE_COMMAND }, { pid: 57094, command: 'node --test café.test.js' }] });
  const escaped = "M-gM^]M-!M-hM-'M^I 4";
  for (const [locale, chinese, french] of [
    [C, escaped, 'node --test cafM-CM-).test.js'],
    [{ LANG: 'C' }, escaped, 'node --test cafM-CM-).test.js'],
    [{ LANG: 'zh_CN.UTF-8' }, CHINESE_COMMAND, 'node --test café.test.js'],
    [{ LC_CTYPE: 'UTF-8' }, CHINESE_COMMAND, 'node --test café.test.js'],
    [{ LC_CTYPE: 'C.UTF-8', LC_TIME: 'C' }, CHINESE_COMMAND, 'node --test café.test.js'],
    // LC_ALL wins over LC_CTYPE and LANG.
    [{ LC_ALL: 'C', LANG: 'zh_CN.UTF-8' }, escaped, 'node --test cafM-CM-).test.js'],
    [{ LC_ALL: 'de_DE.UTF-8', LC_CTYPE: 'C' }, CHINESE_COMMAND, 'node --test café.test.js'],
    // LC_TIME does not change the command.
    [{ LANG: 'zh_CN.UTF-8', LC_TIME: 'C' }, CHINESE_COMMAND, 'node --test café.test.js'],
  ]) {
    const read = tableRead(box, locale);
    assert.equal(read.status, 0, `${named(locale)}: ${read.stderr}`);
    assert.ok(lineOf(read, 57093).endsWith(`     ${chinese}`), `${named(locale)}: ${lineOf(read, 57093)}`);
    assert.ok(lineOf(read, 57094).endsWith(`     ${french}`), `${named(locale)}: ${lineOf(read, 57094)}`);
  }
});

test('the fake ps writes psTableLines as they are, after the processes and before its own row, whatever the locale (#801)', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ processes: [{ pid: 57095 }], psTableLines: ['not a line of ps', '睡觉'] });

  for (const locale of [C, { LANG: 'de_DE.UTF-8' }]) {
    const read = tableRead(box, locale);
    assert.equal(read.status, 0, read.stderr);
    const lines = read.stdout.split('\n');
    const at = lines.indexOf('not a line of ps');
    assert.ok(at > lines.findIndex((line) => /^\s*57095\s/.test(line)), `after the processes: ${read.stdout}`);
    assert.equal(lines[at + 1], '睡觉', 'as it is, whatever the locale');
    assert.match(lines[at + 2], /\bps -A -ww -o\b/, `then the fake's own row: ${read.stdout}`);
  }
});
