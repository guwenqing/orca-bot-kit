// The fake lsof and stty every sandbox runs (helpers/fake-tty.js, #498). The
// kit reads a new tab's tty through them to tell a shell at its prompt from a
// shell that is asking a question. A fake that answered "ready" to every shape
// of call, or put the words in the wrong place, would make every test of that
// gate a test of nothing.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';

/** Call the fake Orca the way the kit would, and insist it answered. */
function ask(box, args) {
  const done = spawnSync(box.orca.cli, [...args, '--json'], { cwd: box.cwd, env: box.env, encoding: 'utf8' });
  assert.equal(done.status, 0, `the fake Orca should have answered ${args.join(' ')}: ${done.stdout}${done.stderr}`);
  return JSON.parse(done.stdout).result;
}

/** A folder project with one tab in it titled `title`, and the pane pid Orca's diagnostics give it. */
function oneTab(box, title = 'Coder daily') {
  const home = box.path('bots', 'bots', 'coder');
  // A git repo of its own, which Orca registers at its own path, whether it is
  // Orca 1.4.240, which registers a repo's top folder, or an older one (#712).
  mkdirSync(home, { recursive: true });
  const repo = spawnSync('git', ['init', '--quiet', home], { env: { ...box.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });
  assert.equal(repo.status, 0, repo.stderr);
  const added = ask(box, ['repo', 'add', '--path', home]);
  ask(box, ['project', 'setup-update', '--setup', added.repo.id, '--kind', 'folder']);
  const made = ask(box, ['terminal', 'create', '--worktree', `path:${home}`, '--title', title]);
  const panes = ask(box, ['diagnostics', 'memory']).worktrees.flatMap((worktree) => worktree.sessions);
  const pane = panes.find((one) => one.sessionId === made.terminal.ptyId);
  assert.ok(pane, `the tab should have a pane, got: ${JSON.stringify(panes)}`);
  return { handle: made.terminal.handle, pid: pane.pid };
}

/** The kit's one lsof call: fd 0 of every process of the user's, `uid` the caller's own unless given. */
const lsof = (box, uid = process.getuid()) => spawnSync(box.lsof.cli, ['-a', '-R', '-d', '0', '-u', String(uid), '-FpRn'], { env: box.env, encoding: 'utf8' });
const stty = (box, tty) => spawnSync(box.stty.cli, ['-a', '-f', tty], { env: box.env, encoding: 'utf8' });

/** lsof's records, `{ pid, ppid, fd, name }` each, from its field lines. */
function recordsFrom(done) {
  assert.equal(done.status, 0, `lsof should have listed the user's fd 0: ${done.stderr}`);
  const records = [];
  for (const line of done.stdout.split('\n').filter((one) => one !== '')) {
    if (line.startsWith('p')) records.push({ pid: Number(line.slice(1)) });
    else if (line.startsWith('R')) records.at(-1).ppid = Number(line.slice(1));
    else if (line.startsWith('f')) records.at(-1).fd = line.slice(1);
    else if (line.startsWith('n')) records.at(-1).name = line.slice(1);
    else assert.fail(`lsof -F prints fields, got: ${line}`);
  }
  return records;
}

/** The name on fd 0 of the pane's shell: the record whose parent is the pane, or which is the pane. */
function ttyFrom(done, pane) {
  const records = recordsFrom(done);
  return (records.find((one) => one.ppid === pane) ?? records.find((one) => one.pid === pane))?.name;
}

/** The words of stty's lflags, the continuation rows included. */
/** The lnext character stty's cchars give, or undefined when none is listed. */
function lnextOf(done) {
  assert.equal(done.status, 0, `stty should have read the tty: ${done.stderr}`);
  const at = done.stdout.indexOf('cchars:');
  assert.ok(at >= 0, `stty -a prints a cchars part, got:\n${done.stdout}`);
  return /(?:^|[;\s])lnext\s*=\s*([^;\s]+)/.exec(done.stdout.slice(at))?.[1];
}

function lflagsOf(done) {
  assert.equal(done.status, 0, `stty should have read the tty: ${done.stderr}`);
  const rows = done.stdout.split('\n');
  const at = rows.findIndex((row) => row.startsWith('lflags:'));
  assert.ok(at >= 0, `stty -a prints an lflags row, got:\n${done.stdout}`);
  const own = [rows[at].slice('lflags:'.length)];
  for (const row of rows.slice(at + 1)) {
    if (!row.startsWith('\t')) break;
    own.push(row);
  }
  return own.join(' ').trim().split(/\s+/);
}

test('the fake lsof names the tab\'s tty on fd 0, in the fields macOS prints, and stty reads it at a ready prompt', async (t) => {
  const box = await createSandbox(t);
  const { pid } = oneTab(box);

  // One record per process, in the fields macOS prints; the root-owned login,
  // the pane itself, is not among them, and its shell is, as its child.
  const found = lsof(box);
  const records = recordsFrom(found);
  assert.ok(records.every((one) => Number.isInteger(one.ppid) && one.fd === '0' && typeof one.name === 'string'), `got: ${found.stdout}`);
  assert.equal(records.some((one) => one.pid === pid), false, 'the login is root\'s, not the user\'s');
  const tty = ttyFrom(found, pid);
  assert.match(tty, /^\/dev\/ttys\d{3}$/);
  // Processes of the user's that are no tab's come first, one on a tty of its own.
  const first = records.find((one) => one.name.startsWith('/dev/ttys'));
  assert.notEqual(first.name, tty, 'the first tty listed is not the tab\'s, so only the right record gives it');
  assert.ok(records.some((one) => one.name === '/dev/null'), 'and some have no tty at all');

  // zsh at its prompt, as measured live: -icanon and -echo, with the other
  // flags whose names start with "echo" beside them.
  const flags = lflagsOf(stty(box, tty));
  assert.ok(flags.includes('-icanon') && !flags.includes('icanon'), `got: ${flags.join(' ')}`);
  assert.ok(flags.includes('-echo') && !flags.includes('echo'), `got: ${flags.join(' ')}`);
  assert.ok(flags.includes('echoe') && flags.includes('echok'), 'the look-alike flags are there to be told apart');
});

test('the fake lsof and stty answer one shape each, and write every call down', async (t) => {
  const box = await createSandbox(t);
  const { pid } = oneTab(box);
  const tty = ttyFrom(lsof(box), pid);
  const uid = String(process.getuid());

  for (const argv of [['-a', '-p', String(pid), '-d', '0', '-Fn'], ['-a', '-R', '-d', '0', '-u', uid, '-Fn'], ['-a', '-R', '-d', '0', '-u', 'me', '-FpRn'], ['-R', '-d', '0', '-u', uid, '-FpRn']]) {
    const refused = spawnSync(box.lsof.cli, argv, { env: box.env, encoding: 'utf8' });
    assert.equal(refused.status, 70, `lsof ${argv.join(' ')} is not the kit's read`);
  }
  for (const argv of [['-a'], ['-f', tty], ['-a', '-f', tty, 'raw'], ['sane']]) {
    const refused = spawnSync(box.stty.cli, argv, { env: box.env, encoding: 'utf8' });
    assert.equal(refused.status, 70, `stty ${argv.join(' ')} is not the kit's read`);
  }

  const missing = lsof(box, process.getuid() + 1);
  assert.equal(missing.status, 1, 'another user, whose processes the caller is not');
  assert.equal(missing.stdout, '');
  assert.equal(stty(box, '/dev/ttys999').status, 1, 'a tty no tab has');

  assert.equal((await box.lsof.calls()).length, 6, 'every lsof call is on the record, the refused ones too');
  assert.equal((await box.stty.calls()).length, 5, 'and every stty call');
  assert.deepEqual((await box.stty.calls()).at(-1).args, ['-a', '-f', '/dev/ttys999']);
});

test('the fake tty reads as each shell state a test names, for every tab or for one tab by its name', async (t) => {
  const box = await createSandbox(t);
  const daily = oneTab(box, 'Coder daily');
  const night = oneTab(box, 'Coder night');
  const ttyDaily = ttyFrom(lsof(box), daily.pid);
  const ttyNight = ttyFrom(lsof(box), night.pid);
  assert.notEqual(ttyDaily, ttyNight, 'each tab has its own tty');

  // As measured in a pty (#498, the review of PR #499).
  const cases = [
    ['question', { icanon: '-icanon', echo: 'echo', lnext: '^V' }],
    ['silent-key', { icanon: '-icanon', echo: '-echo', lnext: '^V' }],
    ['read', { icanon: 'icanon', echo: 'echo', lnext: '^V' }],
    ['secret', { icanon: 'icanon', echo: '-echo', lnext: '^V' }],
    ['no-lnext', { icanon: '-icanon', echo: '-echo', lnext: undefined }],
    ['prompt', { icanon: '-icanon', echo: '-echo', lnext: '<undef>' }],
  ];
  for (const [mode, want] of cases) {
    await box.orca.set({ byName: { night: { tty: mode } } });
    const read = stty(box, ttyNight);
    const flags = lflagsOf(read);
    assert.ok(flags.includes(want.icanon) && flags.includes(want.echo), `${mode}: got ${flags.join(' ')}`);
    assert.equal(lnextOf(read), want.lnext, `${mode}: lnext`);
    const other = stty(box, ttyDaily);
    assert.ok(lflagsOf(other).includes('-icanon') && lflagsOf(other).includes('-echo'), `the other tab stays at its prompt: ${lflagsOf(other).join(' ')}`);
    assert.equal(lnextOf(other), '<undef>', 'with lnext <undef>');
  }

  await box.orca.set({ byName: {}, tty: 'question' });
  assert.ok(lflagsOf(stty(box, ttyDaily)).includes('echo'), 'set for every tab, every tab asks');
});

test('the fake tty moves on with each look when it is given a list', async (t) => {
  const box = await createSandbox(t);
  const { pid } = oneTab(box);
  const tty = ttyFrom(lsof(box), pid);
  await box.orca.set({ tty: ['question', 'question', 'prompt'] });

  const echoes = [1, 2, 3, 4].map(() => lflagsOf(stty(box, tty)).includes('echo'));
  assert.deepEqual(echoes, [true, true, false, false], 'two looks at the question, then the prompt for good');
});

test('the fake lsof lists a pane that is the shell itself as the record with the pane\'s pid', async (t) => {
  const box = await createSandbox(t);
  const { pid } = oneTab(box, 'Coder daily');
  await box.orca.set({ byName: { daily: { front: 'bare-shell' } } });

  const records = recordsFrom(lsof(box));
  const pane = records.find((one) => one.pid === pid);
  assert.ok(pane, `the pane is the user's shell, so it is listed, got: ${JSON.stringify(records)}`);
  assert.match(pane.name, /^\/dev\/ttys\d{3}$/);
  assert.equal(records.some((one) => one.ppid === pid), false, 'and nothing runs under it');
});

test('the fake lsof and stty answer as late as a test says, and answer as ever', async (t) => {
  const box = await createSandbox(t);
  const { pid } = oneTab(box, 'Coder daily');
  await box.orca.set({ lsofDelayMs: 1500, byName: { daily: { sttyDelayMs: 1500 } } });

  let from = Date.now();
  const tty = ttyFrom(lsof(box), pid);
  assert.ok(Date.now() - from >= 1400, 'lsof held its answer back');
  assert.match(tty, /^\/dev\/ttys\d{3}$/);

  from = Date.now();
  const read = stty(box, tty);
  assert.ok(Date.now() - from >= 1400, 'stty held its answer back');
  assert.ok(lflagsOf(read).includes('-echo') && lnextOf(read) === '<undef>', 'and then answered a ready prompt');
});

test('the fake ps answers as late as a test says, and answers as ever', async (t) => {
  const box = await createSandbox(t);
  const { pid } = oneTab(box);
  await box.orca.set({ psDelayMs: 1500 });

  const from = Date.now();
  const read = spawnSync(box.ps.cli, ['-o', 'pid=,ppid=,tpgid=,comm=', '-p', String(pid)], { env: box.env, encoding: 'utf8' });
  assert.ok(Date.now() - from >= 1400, 'ps held its answer back');
  assert.equal(read.status, 0, read.stderr);
  assert.match(read.stdout, /\/usr\/bin\/login/);
});

test('the fake lsof and stty fail the ways a test names', async (t) => {
  const box = await createSandbox(t);
  const { pid } = oneTab(box);
  const tty = ttyFrom(lsof(box), pid);

  await box.orca.set({ tty: 'lsof-fails' });
  const failed = lsof(box);
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.notEqual(failed.stderr, '');

  await box.orca.set({ tty: 'no-tty' });
  assert.equal(ttyFrom(lsof(box), pid), '/dev/null', 'fd 0 is there and is no tty');

  await box.orca.set({ tty: 'stty-fails' });
  const unread = stty(box, tty);
  assert.equal(unread.status, 1);
  assert.notEqual(unread.stderr, '');
});

test('the fake ps puts what a test names in front of a tab nothing was launched in, and the shell otherwise', async (t) => {
  const box = await createSandbox(t);
  const daily = oneTab(box, 'Coder daily');
  const night = oneTab(box, 'Coder night');
  await box.orca.set({ byName: { night: { front: 'program' } } });

  const front = (pid) => {
    const read = (one) => spawnSync(box.ps.cli, ['-o', 'pid=,ppid=,tpgid=,comm=', '-p', String(one)], { env: box.env, encoding: 'utf8' }).stdout.trim().split(/\s+/);
    const tpgid = read(pid)[2];
    return read(tpgid).slice(3).join(' ');
  };
  assert.equal(front(night.pid), 'less', 'the named tab has a program in front');
  assert.equal(front(daily.pid), '-/bin/zsh', 'its sister has its shell');
});

test('the fake shows one tab the screen a test gave it by name, and its sister the screen it always had', async (t) => {
  const box = await createSandbox(t);
  const daily = oneTab(box, 'Coder daily');
  const night = oneTab(box, 'Coder night');
  const asking = ['Last login: Mon Oct  5 09:12:01 on ttys002', '[oh-my-zsh] Would you like to update? [Y/n]', ''];
  await box.orca.set({ byName: { night: { screen: asking } } });

  const read = (handle) => ask(box, ['terminal', 'read', '--terminal', handle, '--screen']).terminal.tail;
  assert.deepEqual(read(night.handle), asking);
  assert.notDeepEqual(read(daily.handle), asking);
});
