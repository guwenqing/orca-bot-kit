// How a live test reads the command line of the Codex in front of a tab
// (helpers/codex-command-line.js, #860), as `ps -ww -o command=` prints it.
//
// Orca's own `codex` shell function (Orca 1.4.263 to 1.4.272,
// out/shared/shell/launch/agents/codex-shell-function.js) puts its identity
// arguments in front of the arguments the kit typed: for each of
// ORCA_TERMINAL_HANDLE, ORCA_PANE_KEY, ORCA_WORKTREE_ID, ORCA_WORKSPACE_ID and
// ORCA_USER_DATA_PATH that is set and holds no apostrophe, the pair `-c`
// `shell_environment_policy.set.<KEY>='<value>'`, each one put first, and then
// possibly `-c` `shell_environment_policy.set.SSH_CONNECTION=''` first of all.
// `ps` joins the words with one space and drops the shell's quoting, so a value
// with a space in it (ORCA_USER_DATA_PATH is under `Application Support`) is
// cut into pieces by a split on white space. That split made the resume assert
// of restart.test.js fail live (#860).
//
// What the helper gives: `codexCommandOf(line)`, the program, Orca's identity
// pairs and the kit's own words after them; `resumeFault(line, id)`, why the
// line is not the kit's resume of `id` (undefined when it is); and
// `freshStartFault(line)`, why it is not the kit's fresh start (undefined when
// it is). Every expected value here is written out by hand from Orca's source
// and the kit's launch line (src/launch.js: `codex [resume] --approve-for-me
// --no-daemon …`, the id last on a resume).

import assert from 'node:assert/strict';
import test from 'node:test';

import { codexCommandOf, freshStartFault, resumeFault } from './helpers/codex-command-line.js';

/** A conversation id as Codex writes it. */
const ID = '019a6d2e-5f1c-7b30-9a41-3c2d8e7f6a10';

/** Orca's identity pairs as one ps line shows them, in Orca's order: the last key in its list first. */
const ORCA_FRONT = [
  "-c shell_environment_policy.set.ORCA_USER_DATA_PATH='/Users/q/Library/Application Support/orca'",
  "-c shell_environment_policy.set.ORCA_WORKSPACE_ID='ws_4f1a9c'",
  "-c shell_environment_policy.set.ORCA_WORKTREE_ID='wt_7d2e10'",
  "-c shell_environment_policy.set.ORCA_PANE_KEY='pane-3:1'",
  "-c shell_environment_policy.set.ORCA_TERMINAL_HANDLE='term_8c0b5e'",
].join(' ');

/** The SSH marker Orca blanks, first of all when it is there. */
const SSH_FRONT = "-c shell_environment_policy.set.SSH_CONNECTION=''";

/** The kit's own words after the resume subcommand, as a system test's Codex session has them, the id last. */
const KIT_RESUME = [
  'resume', '--approve-for-me', '--no-daemon',
  '-c', 'sandbox_workspace_write.network_access=true',
  '-c', 'projects={"/private/var/folders/x1/T/obk-system-restart-codex-Ab1c"={trust_level="trusted"}}',
  '--dangerously-bypass-hook-trust',
  '-c', 'tui.show_tooltips=false', '-c', 'features.sleep_tool=false', '-c', 'check_for_update_on_startup=false',
  ID,
];

/** The kit's own words on a fresh start: no subcommand, and the prompt last, as ps shows it with its spaces. */
const KIT_FRESH = '--approve-for-me --no-daemon -c sandbox_workspace_write.network_access=true --dangerously-bypass-hook-trust You are a system test\'s bot and you own nothing.';

const line = (...parts) => parts.filter((part) => part !== '').join(' ');

// ------------------------------------------------------------- codexCommandOf

test('R2: a line with all five identity pairs in front gives the program, each pair with its whole value, and the kit\'s words after them', () => {
  assert.deepEqual(codexCommandOf(line('codex', ORCA_FRONT, KIT_RESUME.join(' '))), {
    program: 'codex',
    identity: [
      { key: 'ORCA_USER_DATA_PATH', value: '/Users/q/Library/Application Support/orca' },
      { key: 'ORCA_WORKSPACE_ID', value: 'ws_4f1a9c' },
      { key: 'ORCA_WORKTREE_ID', value: 'wt_7d2e10' },
      { key: 'ORCA_PANE_KEY', value: 'pane-3:1' },
      { key: 'ORCA_TERMINAL_HANDLE', value: 'term_8c0b5e' },
    ],
    args: KIT_RESUME,
  });
});

test('R2: a line with no identity pairs gives no identity and every word after the program', () => {
  assert.deepEqual(codexCommandOf(line('codex', KIT_RESUME.join(' '))), { program: 'codex', identity: [], args: KIT_RESUME });
});

test('R2: the blank SSH marker is an identity pair too, with an empty value', () => {
  const read = codexCommandOf(line('codex', SSH_FRONT, "-c shell_environment_policy.set.ORCA_TERMINAL_HANDLE='term_1'", KIT_RESUME.join(' ')));
  assert.deepEqual(read.identity, [
    { key: 'SSH_CONNECTION', value: '' },
    { key: 'ORCA_TERMINAL_HANDLE', value: 'term_1' },
  ]);
  assert.deepEqual(read.args, KIT_RESUME);
});

test('R2: a value keeps every space it has, two in a row included, and words in it are not the kit\'s', () => {
  const read = codexCommandOf(line('codex', "-c shell_environment_policy.set.ORCA_USER_DATA_PATH='/Users/q/two  spaces resume --no-daemon x'", KIT_RESUME.join(' ')));
  assert.deepEqual(read.identity, [{ key: 'ORCA_USER_DATA_PATH', value: '/Users/q/two  spaces resume --no-daemon x' }]);
  assert.deepEqual(read.args, KIT_RESUME);
});

test('R2: the scan of identity pairs stops at the first word that is not one, and that word is the first of the args', () => {
  const read = codexCommandOf(line('codex', "-c shell_environment_policy.set.ORCA_PANE_KEY='p'", '-c model=o3', "-c shell_environment_policy.set.ORCA_TERMINAL_HANDLE='t'", KIT_RESUME.join(' ')));
  assert.deepEqual(read.identity, [{ key: 'ORCA_PANE_KEY', value: 'p' }]);
  assert.deepEqual(read.args.slice(0, 5), ['-c', 'model=o3', '-c', "shell_environment_policy.set.ORCA_TERMINAL_HANDLE='t'", 'resume']);
});

test('R2: a pair with a word glued after its closing apostrophe is one word, not Orca\'s pair, and not the resume that follows', () => {
  const read = codexCommandOf(line('codex', "-c shell_environment_policy.set.ORCA_PANE_KEY='p'resume --approve-for-me --no-daemon", ID));
  assert.deepEqual(read.identity, []);
  assert.deepEqual(read.args, ['-c', "shell_environment_policy.set.ORCA_PANE_KEY='p'resume", '--approve-for-me', '--no-daemon', ID]);
  assert.equal(typeof resumeFault(line('codex', "-c shell_environment_policy.set.ORCA_PANE_KEY='p'resume --approve-for-me --no-daemon", ID), ID), 'string');
});

// ------------------------------------------------------------- resumeFault

test('R2: the kit\'s resume with Orca\'s five identity pairs in front is a resume of the book\'s id', () => {
  assert.equal(resumeFault(line('codex', ORCA_FRONT, KIT_RESUME.join(' ')), ID), undefined);
});

test('R2: the kit\'s resume with no identity pairs, with only some of them, with the SSH marker, or by a full path to codex, is a resume', () => {
  const tail = KIT_RESUME.join(' ');
  assert.equal(resumeFault(line('codex', tail), ID), undefined, 'none in front');
  assert.equal(resumeFault(line('codex', "-c shell_environment_policy.set.ORCA_WORKTREE_ID='wt_7d2e10' -c shell_environment_policy.set.ORCA_TERMINAL_HANDLE='term_8c0b5e'", tail), ID), undefined, 'two of the five');
  assert.equal(resumeFault(line('codex', SSH_FRONT, ORCA_FRONT, tail), ID), undefined, 'the SSH marker first, then the five');
  assert.equal(resumeFault(line('/opt/homebrew/bin/codex', ORCA_FRONT, tail), ID), undefined, 'codex by its full path');
});

test('R2: the identity pairs in another order are still only Orca\'s identity pairs', () => {
  const reversed = [
    "-c shell_environment_policy.set.ORCA_TERMINAL_HANDLE='term_8c0b5e'",
    "-c shell_environment_policy.set.ORCA_PANE_KEY='pane-3:1'",
    "-c shell_environment_policy.set.ORCA_USER_DATA_PATH='/Users/q/Library/Application Support/orca'",
    SSH_FRONT,
  ].join(' ');
  assert.equal(resumeFault(line('codex', reversed, KIT_RESUME.join(' ')), ID), undefined);
});

test('R2: anything else in front of resume is not a resume: another -c, another key, a plain word', () => {
  const tail = KIT_RESUME.join(' ');
  for (const [what, front] of [
    ['another -c setting', '-c model=o3'],
    ['another -c setting after an identity pair', `${ORCA_FRONT} -c model=o3`],
    ['a key of shell_environment_policy.set that is not Orca\'s', "-c shell_environment_policy.set.ORCA_OTHER='x'"],
    ['a key that only starts like one of Orca\'s', "-c shell_environment_policy.set.ORCA_PANE_KEYS='x'"],
    ['another policy than set', "-c shell_environment_policy.inherit.ORCA_PANE_KEY='x'"],
    ['a plain flag', '--yolo'],
    ['a plain flag after the identity pairs', `${ORCA_FRONT} --yolo`],
    ['an identity pair with no -c', "shell_environment_policy.set.ORCA_PANE_KEY='x'"],
    ['an identity value in double quotes', '-c shell_environment_policy.set.ORCA_PANE_KEY="x"'],
    ['an identity value with no quotes', '-c shell_environment_policy.set.ORCA_PANE_KEY=x'],
    ['an identity value whose quote is never closed', "-c shell_environment_policy.set.ORCA_USER_DATA_PATH='/Users/q/Library/Application"],
    ['an identity value with a word glued after its quote', "-c shell_environment_policy.set.ORCA_PANE_KEY='x'y"],
  ]) {
    const said = resumeFault(line('codex', front, tail), ID);
    assert.equal(typeof said, 'string', `${what}: ${line('codex', front, tail)}`);
    assert.ok(said.length > 0, `${what}: the fault says why`);
  }
});

test('R2: an identity key given twice, an identity value left empty, or an SSH marker with a value is not Orca\'s', () => {
  const tail = KIT_RESUME.join(' ');
  assert.equal(typeof resumeFault(line('codex', "-c shell_environment_policy.set.ORCA_PANE_KEY='a' -c shell_environment_policy.set.ORCA_PANE_KEY='b'", tail), ID), 'string', 'a key twice');
  assert.equal(typeof resumeFault(line('codex', "-c shell_environment_policy.set.ORCA_PANE_KEY=''", tail), ID), 'string', 'an empty identity value: Orca leaves an unset key out');
  assert.equal(typeof resumeFault(line('codex', "-c shell_environment_policy.set.SSH_CONNECTION='10.0.0.1 22 10.0.0.2 22'", tail), ID), 'string', 'the SSH marker with a value: Orca only blanks it');
  assert.equal(typeof resumeFault(line('codex', SSH_FRONT, SSH_FRONT, tail), ID), 'string', 'the SSH marker twice');
});

test('R2: the harness is codex, and only codex', () => {
  const tail = KIT_RESUME.join(' ');
  assert.equal(typeof resumeFault(line('node', '/opt/homebrew/bin/codex', tail), ID), 'string', 'node running a script named codex');
  assert.equal(typeof resumeFault(line('codex-beta', tail), ID), 'string', 'a program with a longer name');
  assert.equal(typeof resumeFault(line('claude', tail), ID), 'string', 'another harness');
  assert.equal(typeof resumeFault('', ID), 'string', 'nothing read at all');
});

test('R2: the first word after the identity pairs is resume, or it is not a resume', () => {
  const words = KIT_RESUME.slice(1).join(' ');
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, words), ID), 'string', 'no resume at all');
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, '--approve-for-me resume --no-daemon', ID), ID), 'string', 'resume, but not first');
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, 'resumed --approve-for-me --no-daemon', ID), ID), 'string', 'a word that only starts with resume');
});

test('R2: --no-daemon is there once, straight after --approve-for-me', () => {
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, 'resume --approve-for-me', ID), ID), 'string', 'no --no-daemon');
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, 'resume --approve-for-me --no-daemon --no-daemon', ID), ID), 'string', '--no-daemon twice');
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, 'resume --approve-for-me --no-daemon -c x=1 --no-daemon', ID), ID), 'string', '--no-daemon twice, apart');
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, 'resume --approve-for-me -c x=1 --no-daemon', ID), ID), 'string', '--no-daemon, not straight after');
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, 'resume --no-daemon --approve-for-me', ID), ID), 'string', 'the two the other way round');
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, 'resume --no-daemon', ID), ID), 'string', 'no --approve-for-me');
  assert.equal(resumeFault(line('codex', "-c shell_environment_policy.set.ORCA_USER_DATA_PATH='/x --no-daemon y'", KIT_RESUME.join(' ')), ID), undefined, 'a --no-daemon inside an identity value is not one of the kit\'s');
});

test('R2: the book\'s id is the last word, and no other id', () => {
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, KIT_RESUME.join(' ')), '019a6d2e-0000-7b30-9a41-3c2d8e7f6a10'), 'string', 'another id');
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, 'resume --approve-for-me --no-daemon', ID, '-c x=1'), ID), 'string', 'the id, but not last');
  assert.equal(typeof resumeFault(line('codex', ORCA_FRONT, 'resume --approve-for-me --no-daemon'), ID), 'string', 'no id at all');
});

test('R2: white space around the line, as ps may leave it, changes nothing', () => {
  assert.equal(resumeFault(`  ${line('codex', ORCA_FRONT, KIT_RESUME.join(' '))}\n`, ID), undefined);
});

// ------------------------------------------------------------- freshStartFault

test('R2: the kit\'s fresh start, with Orca\'s identity pairs in front or none, is a fresh start', () => {
  assert.equal(freshStartFault(line('codex', ORCA_FRONT, KIT_FRESH)), undefined, 'with the five');
  assert.equal(freshStartFault(line('codex', SSH_FRONT, ORCA_FRONT, KIT_FRESH)), undefined, 'with the SSH marker too');
  assert.equal(freshStartFault(line('codex', KIT_FRESH)), undefined, 'with none');
  assert.equal(freshStartFault(line('codex', "-c shell_environment_policy.set.ORCA_USER_DATA_PATH='/Users/q/a resume b'", KIT_FRESH)), undefined, 'a resume inside an identity value is not a resume');
});

test('R2: a fresh start is not a resume', () => {
  assert.equal(typeof freshStartFault(line('codex', ORCA_FRONT, KIT_RESUME.join(' '))), 'string', 'the kit\'s resume');
  assert.equal(typeof freshStartFault(line('codex', ORCA_FRONT, '--approve-for-me --no-daemon resume', ID)), 'string', 'resume anywhere in the kit\'s words');
});

test('R2: a fresh start carries --no-daemon once, straight after --approve-for-me', () => {
  assert.equal(typeof freshStartFault(line('codex', ORCA_FRONT, '--approve-for-me hello')), 'string', 'no --no-daemon');
  assert.equal(typeof freshStartFault(line('codex', ORCA_FRONT, '--approve-for-me --no-daemon --no-daemon hello')), 'string', '--no-daemon twice');
  assert.equal(typeof freshStartFault(line('codex', ORCA_FRONT, '--approve-for-me -c x=1 --no-daemon hello')), 'string', 'not straight after');
  assert.equal(typeof freshStartFault(line('codex', ORCA_FRONT, '--no-daemon hello')), 'string', 'no --approve-for-me');
});

// ------------------------------------------------------------- generated inputs

/** A small seeded generator (mulberry32), so a failure can be run again exactly. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

/** The characters a generated value is made of: no apostrophe, which Orca never sends; spaces and dashes weighted in. */
const VALUE_PIECES = ['a', 'Z', '0', '/', '.', ':', '_', '-', ' ', ' ', '  ', ' resume ', ' --no-daemon ', ' -c ', '=', '"', 'é', '~'];

const IDENTITY_KEYS = ['ORCA_TERMINAL_HANDLE', 'ORCA_PANE_KEY', 'ORCA_WORKTREE_ID', 'ORCA_WORKSPACE_ID', 'ORCA_USER_DATA_PATH'];

// The property: for any set of Orca's identity keys, each once, in any order,
// with any value Orca would send (not empty, no apostrophe), and the SSH marker
// or not, the kit's resume behind them is a resume, its fresh start is a fresh
// start, and each value comes back whole. And a plain word put between the
// pairs and the kit's words makes it no resume.
test('R2: generated identity fronts: the resume and the fresh start hold behind any of Orca\'s, and a word more in front breaks the resume', () => {
  const seed = 860;
  const random = seeded(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  for (let round = 0; round < 500; round += 1) {
    const keys = IDENTITY_KEYS.filter(() => random() < 0.6).sort(() => random() - 0.5);
    const pairs = keys.map((key) => {
      let value = '';
      const length = 1 + Math.floor(random() * 12);
      while (value.length < length) value += pick(VALUE_PIECES);
      return { key, value };
    });
    const front = pairs.map(({ key, value }) => `-c shell_environment_policy.set.${key}='${value}'`);
    if (random() < 0.3) front.unshift(SSH_FRONT);
    const resume = line('codex', front.join(' '), KIT_RESUME.join(' '));
    const where = `seed ${seed}, round ${round}: ${resume}`;
    assert.equal(resumeFault(resume, ID), undefined, where);
    assert.deepEqual(codexCommandOf(resume).identity.filter((pair) => pair.key !== 'SSH_CONNECTION'), pairs, where);
    assert.equal(freshStartFault(line('codex', front.join(' '), KIT_FRESH)), undefined, where);
    assert.equal(typeof resumeFault(line('codex', front.join(' '), pick(['--yolo', '-c model=o3', 'exec']), KIT_RESUME.join(' ')), ID), 'string', where);
  }
});
