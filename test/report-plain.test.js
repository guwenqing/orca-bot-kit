// The plain lines, for the person or the agent reading along without `--json`.
//
// They must carry the same facts the JSON carries. The bug this guards against
// is a quiet one: a field was renamed, the JSON tests followed it and the plain
// report did not, so every newly created tab was reported as "nothing was
// typed into it" while the harness was in fact up and running. Nothing in the
// suite noticed, because nothing asserted what the lines say about a harness
// that started.
//
// So these tests read the lines against the JSON answer for the same run, and
// against each other: a run whose harness came up must not read like one whose
// harness did not.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, TAB_TITLES } from './helpers/cli.js';

/** Run `init` twice over, plainly and as JSON, and read both answers. */
async function bothReports(box, state = {}) {
  await box.orca.set(state);
  const plain = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(plain.code, 0, plain.stderr);

  // A second sandbox would give different ids; the same one run again reports
  // the same tabs, found rather than made, so `--json` is asked on a fresh one.
  const other = await createSandbox(box.t);
  await other.orca.set(state);
  const asJson = await other.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']);
  assert.equal(asJson.code, 0, asJson.stderr);

  return { plain: plain.stdout, answer: JSON.parse(asJson.stdout) };
}

/** The same report with everything that differs between sandboxes taken out. */
const withoutTheSandbox = (box, stdout) => stdout.split(box.root).join('<root>');

test('the plain lines carry every fact the JSON carries', async (t) => {
  const box = await createSandbox(t);
  box.t = t;

  const { plain, answer } = await bothReports(box);

  assert.ok(answer.tabs.length > 0);
  for (const tab of answer.tabs) {
    for (const fact of [tab.title, tab.tabId, tab.terminal]) {
      assert.ok(plain.includes(fact), `the lines should carry ${fact}, got: ${plain}`);
    }
  }
});

test('a harness that came up does not read like one that did not', async (t) => {
  const box = await createSandbox(t);
  const started = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  const other = await createSandbox(t);
  await other.orca.set({ waitIdle: false });
  const never = await other.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(started.code, 0, started.stderr);
  assert.equal(never.code, 0, never.stderr);
  assert.notEqual(
    withoutTheSandbox(box, started.stdout),
    withoutTheSandbox(other, never.stdout),
    'a harness that started and one that never came up must not read the same',
  );
});

test('neither report claims nothing was typed, because the text was typed', async (t) => {
  // The one place these tests weigh words, and the requirement is about words:
  // the text went into the tab whether or not a harness came up, and a report
  // that says otherwise sends the caller to look for a tab that never ran
  // anything. `waitIdle: false` is the case the old report got wrong.
  for (const waitIdle of [true, false]) {
    const box = await createSandbox(t);
    await box.orca.set({ waitIdle });

    const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

    assert.equal(result.code, 0, result.stderr);
    assert.match(
      result.stdout,
      /typed/i,
      `the lines should say the harness was typed in (waitIdle: ${waitIdle}), got: ${result.stdout}`,
    );
    assert.doesNotMatch(
      result.stdout,
      /(?:nothing|no text|not)(?:\s+\w+){0,3}\s+typed/i,
      `the text was typed, so the report must not say it was not (waitIdle: ${waitIdle}): ${result.stdout}`,
    );
    assert.ok(result.stdout.includes(TAB_TITLES.daily), `and name the tab, got: ${result.stdout}`);
  }
});

test('a harness waiting on something passes Orca\'s own words to the reader', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ waitIdle: 'blocked' });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(
    result.stdout.includes('agent-interactive-prompt'),
    `the reader has to know what the tab is waiting on, got: ${result.stdout}`,
  );
  assert.ok(result.stdout.includes(TAB_TITLES.daily));
});

test('a blocked harness does not read like an unblocked one', async (t) => {
  const box = await createSandbox(t);
  const plain = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  const other = await createSandbox(t);
  await other.orca.set({ waitIdle: 'blocked' });
  const blocked = await other.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.notEqual(
    withoutTheSandbox(box, plain.stdout),
    withoutTheSandbox(other, blocked.stdout),
    'a harness with something on screen to answer must not read like one that is idle',
  );
});

for (const [label, state] of [
  ['a harness that came up', {}],
  ['a harness that never came up', { waitIdle: false }],
  ['a harness waiting on something', { waitIdle: 'blocked' }],
]) {
  test(`the report of ${label} has no field it could not read`, async (t) => {
    // A report that reads a field by a name nothing carries any more prints
    // `undefined`, or prints the wrong branch. This catches the first half.
    const box = await createSandbox(t);
    await box.orca.set(state);

    const first = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
    const second = await box.run(['up', '--bots', 'bots']);

    for (const result of [first, second]) {
      assert.equal(result.code, 0, result.stderr);
      assert.ok(!result.stdout.includes('undefined'), `nothing should be undefined, got: ${result.stdout}`);
      assert.ok(!result.stdout.includes('[object Object]'), `nothing half-printed, got: ${result.stdout}`);
    }
  });
}
