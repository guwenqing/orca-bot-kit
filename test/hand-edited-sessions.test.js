// A `bot.yaml` the user edited by hand goes straight to `obk up`. Nothing
// checked it on the way in, so `up` checks it before it opens that session.
//
// `obk session add` refuses an approval level nobody knows and a Claude
// session with a context and no model, and a user who goes through Bot Father
// never meets either. But the file is the user's, they are invited to read and
// edit it, and what they write there is typed into a tab as a shell command.
// An approval level of `yolo` would become a flag the harness does not take —
// it prints its usage, exits, and the tab falls back to a shell. Worse, a
// mapping that quietly dropped it would start a session at the harness's own
// permission level, which is the one failure ADR 0005 exists to stop.
//
// So the refusal comes before the tab is made. A tab opened and then abandoned
// is worse than no tab: the book names it, the next run takes it for a live
// session and leaves it alone, and nobody is ever told.

import assert from 'node:assert/strict';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  bookOf,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  skipGit,
  snapshot,
} from './helpers/cli.js';

/**
 * A seeded bots folder whose Bot Father has hand-written sessions, with no
 * book and nothing of it in Orca: the state a user is in when they edit the
 * file themselves and then run `up`. The sessions are written as text, not
 * added through `session add`, which is the whole point.
 */
async function handEdited(box, harness, sessions) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', harness])).code, 0);
  const bots = box.path('bots');
  await writeFile(
    path.join(botHomeOf(bots, 'bot-father'), 'bot.yaml'),
    `name: bot-father\nharness: ${harness}\ncharter: mine\nrules: []\nskills: []\nsessions:\n${sessions}`,
  );
  await rm(bookOf(bots));
  await box.orca.set({ setups: [], terminals: [] });
  return bots;
}

/** No tab was opened for `session`, and the book does not claim there was one. */
async function assertNotStarted(box, bots, session) {
  const titled = (await box.orca.terminals()).filter((terminal) => terminal.title.endsWith(` ${session}`));
  assert.deepEqual(titled, [], `${session} is a session the kit will not start, so it gets no tab`);

  const written = await readFile(bookOf(bots), 'utf8').catch(() => '');
  const book = written === '' ? {} : (parse(written) ?? {});
  assert.equal(
    book.sessions?.[session],
    undefined,
    `the book must name no tab for a session that was never started, got: ${written}`,
  );
}

test('an approval level nobody knows, written by hand, is refused before a tab is opened', async (t) => {
  const box = await createSandbox(t);
  const bots = await handEdited(box, 'claude', '  - name: daily\n    approval: yolo\n');
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('yolo'), `should name what it found, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('daily'), `should name the session it is in, got: ${result.stderr}`);
  for (const level of ['auto', 'ask', 'dangerously-skip']) {
    assert.ok(
      result.stderr.includes(level),
      `the reader has to be told what to put there instead; ${level} is missing: ${result.stderr}`,
    );
  }
  await assertNotStarted(box, bots, 'daily');
  assert.deepEqual(await box.orca.terminals(), [], 'the one session was the bad one, so nothing was opened at all');
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and nothing of the user\'s file is rewritten');
});

test('a Claude session with a context and no model, written by hand, is refused before a tab is opened', async (t) => {
  // On Claude the context is a suffix on the model, so there is nothing to
  // hang it on and the setting would simply vanish from the launch line.
  const box = await createSandbox(t);
  const bots = await handEdited(box, 'claude', '  - name: daily\n    approval: auto\n    context: 1m\n');
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('daily'), `should name the session it is in, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('--model'), `should say what is missing, got: ${result.stderr}`);
  await assertNotStarted(box, bots, 'daily');
  assert.deepEqual(await box.orca.terminals(), []);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('the same session on Codex is fine: there the context stands on its own', async (t) => {
  // The other side of it, so the refusal above is about the harness and not
  // about a context window as such.
  const box = await createSandbox(t);
  await handEdited(box, 'codex', '  - name: daily\n    approval: auto\n    context: 200000\n');

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const terminals = await box.orca.terminals();
  assert.equal(terminals.length, 2, `the daily tab and the ops tab, got ${JSON.stringify(terminals)}`);
});

test('a session that names the other harness is judged by that one', async (t) => {
  // The bot runs on Codex, so a context with no model would be fine — until
  // the session says it runs on Claude.
  const box = await createSandbox(t);
  const bots = await handEdited(
    box,
    'codex',
    '  - name: daily\n    approval: auto\n    harness: claude\n    context: 1m\n',
  );

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('daily'), `should name the session, got: ${result.stderr}`);
  await assertNotStarted(box, bots, 'daily');
});

test('the bad session is named, and gets no tab, even when a good one came first', async (t) => {
  // The reader has to be told which of their sessions to go and fix, not that
  // something somewhere in the file is wrong. What the good session before it
  // got is a separate question — `up` only ever adds, and running it again
  // after the fix finishes the job.
  const box = await createSandbox(t);
  const bots = await handEdited(
    box,
    'claude',
    '  - name: daily\n    approval: auto\n  - name: review\n    approval: yolo\n',
  );

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('review'), `should name the session that is wrong, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('yolo'), `and what it found there, got: ${result.stderr}`);
  await assertNotStarted(box, bots, 'review');
});

test('a harness nobody knows, written by hand, is refused before a tab is opened', async (t) => {
  // The third thing the file can ask for that cannot be done. `bot create`
  // and `session add` both refuse a harness the kit does not know, so this
  // too can only arrive by hand — and it is the one that would otherwise go
  // furthest: there is no flag mapping to look the session's settings up in,
  // so what reaches the tab is not a wrong flag but a program that is not
  // installed, and the tab is left sitting at a shell.
  const box = await createSandbox(t);
  const bots = await handEdited(box, 'claude', '  - name: daily\n    harness: aider\n');

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('daily'), `should name the session it is in, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('aider'), `should name what it found, got: ${result.stderr}`);
  for (const harness of ['claude', 'codex']) {
    assert.ok(
      result.stderr.includes(harness),
      `the reader has to be told what to put there instead; ${harness} is missing: ${result.stderr}`,
    );
  }
  await assertNotStarted(box, bots, 'daily');
  assert.deepEqual(await box.orca.terminals(), [], 'the one session was the bad one, so nothing was opened at all');
});

test('a refused session gets no work dir either', async (t) => {
  // The work dir is made on the way to the tab, so it says where in the run
  // the refusal comes. A folder left behind by a session that never started
  // is the same lie as a tab left behind: the user goes looking for what is
  // in it, and the next run walks past it because it is already there.
  const box = await createSandbox(t);
  const bots = await handEdited(
    box,
    'claude',
    '  - name: daily\n    approval: auto\n    context: 1m\n    work_dir: work/daily\n',
  );
  const before = await snapshot(bots, skipGit);
  // `init` brought Bot Father up once already, so the calls it made are not
  // this run's; what this run asked Orca for starts after them.
  const seeded = (await box.orca.calls()).length;

  assertCleanFailure(await box.run(['up', '--bots', 'bots']));

  assert.equal(
    await stat(path.join(botHomeOf(bots, 'bot-father'), 'work', 'daily')).then(() => true, () => false),
    false,
    'nothing should be made for a session the kit will not start',
  );
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and the bots folder is as the user left it');
  assert.deepEqual(
    orcaCallsOf((await box.orca.calls()).slice(seeded), 'terminal create'),
    [],
    'and Orca was never asked for the tab',
  );
});
