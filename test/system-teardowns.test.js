// Every system test's teardown closes only the tabs it or the kit created in
// that run (#426, #246's rule applied everywhere).
//
// A teardown used to close every tab at its homes that was not open before the
// run, so a tab someone else opened there meanwhile went too (the review of PR
// #425). The one road now is the tab guard: `guard.closeOwnAt(homes)` closes the
// tabs the guard counts as the test's own and names every other tab it finds
// there as `foreign`, and the teardown fails on a foreign tab before it removes
// the bots folder (test/helpers/tab-guard.js).
//
// This reads the system tests as text; it runs none of them. What it holds a
// teardown to, where a teardown is the function a test hands `t.after(`:
//
//   - it closes no tab itself: no `'terminal', 'close'` call of its own;
//   - it sweeps nothing by "not open before the run": no `.handles.has(`;
//   - one that deletes the test's Orca projects (`'setup-delete'`, or
//     `deleteOwnProject(`) closes its tabs through `guard.closeOwnAt(`, and
//     asserts `foreign` is empty before it calls `removeBotsFolderAndSiblings(`.
//
// And how a system test removes its Orca projects (#536): only through
// `deleteOwnProject(` (test/helpers/own-project.js), which goes on both Orcas
// and force-deletes only the run's own projects. So:
//
//   - no system test sends `setup-delete` itself, or calls `deleteProject(` of
//     src/orca.js, anywhere in its code;
//   - in a teardown, a failed delete fails the teardown, but the rest of the
//     teardown still runs. Each `deleteOwnProject(` is awaited inside a `try`
//     whose `catch (error)` keeps the failure: it uses the error and pushes onto
//     a list (`failed.push(`). The teardown asserts each such list is empty,
//     `assert.deepEqual(failed, []…)`, after `removeBotsFolderAndSiblings(`
//     and after everything else it does: those asserts end the teardown.
//
// A close in the body of a test, of one handle it knows is its own, is not a
// teardown and goes through the guard's `orca`, which counts it for the verdict.
// Comments are taken out before anything is matched, so neither a sweep left in
// a comment nor a comment naming the guard counts.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot, snapshot } from './helpers/cli.js';

const systemTestsDir = path.join(repoRoot, 'test', 'system');

/**
 * Whether a `/` that follows `out` begins a regular expression literal rather
 * than a division: it does after an operator, an opening bracket, a comma, a
 * semicolon, or a keyword such as `return`, and at the start.
 */
const regexMayStart = (out) => {
  const before = out.trimEnd();
  // A postfix `++` or `--` ends an operand, so a `/` after it divides.
  if (/(?:\+\+|--)$/.test(before)) return false;
  return before === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(before)
    // The keyword itself, not a property or a name that ends in it (`obj.in`, `$in`).
    || /(?<![\w$.])(?:return|typeof|case|do|else|in|of|void|yield|await|throw|new|delete)$/.test(before);
};

/**
 * The source with its comments taken out: block comments, and line comments
 * outside strings. Strings and template literals are kept as they are, so a
 * `//` inside a URL or a message is not taken for a comment. A regular
 * expression literal is kept as an empty one, `/(?:)/`, so a quote inside it
 * does not open a string (#536: `/"requestId"\s*:\s*"([^"]+)"/` in a system
 * test kept every comment after it, and ran a teardown past its end).
 */
function withoutComments(source) {
  let out = '';
  let at = 0;
  let quote = null;
  while (at < source.length) {
    const here = source[at];
    const next = source[at + 1];
    if (quote !== null) {
      out += here;
      if (here === '\\') {
        out += next ?? '';
        at += 2;
        continue;
      }
      if (here === quote) quote = null;
      at += 1;
      continue;
    }
    if (here === '/' && next === '/') {
      while (at < source.length && source[at] !== '\n') at += 1;
      continue;
    }
    if (here === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2);
      at = end < 0 ? source.length : end + 2;
      continue;
    }
    if (here === '/' && regexMayStart(out)) {
      let inClass = false;
      at += 1;
      while (at < source.length && source[at] !== '\n') {
        if (source[at] === '\\') at += 1;
        else if (source[at] === '[') inClass = true;
        else if (source[at] === ']') inClass = false;
        else if (source[at] === '/' && !inClass) break;
        at += 1;
      }
      out += '/(?:)/';
      at += 1;
      continue;
    }
    if (here === '\'' || here === '"' || here === '`') quote = here;
    out += here;
    at += 1;
  }
  return out;
}

/** The text of every function handed to `t.after(`, from its opening paren to the one that closes it, in code without comments. */
function teardownsIn(code) {
  const found = [];
  for (const match of code.matchAll(/\bt\.after\(/g)) {
    let depth = 0;
    let quote = null;
    let end = match.index + match[0].length - 1;
    for (; end < code.length; end += 1) {
      const here = code[end];
      if (quote !== null) {
        if (here === '\\') end += 1;
        else if (here === quote) quote = null;
        continue;
      }
      if (here === '\'' || here === '"' || here === '`') quote = here;
      else if (here === '(') depth += 1;
      else if (here === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push(code.slice(match.index, end + 1));
  }
  return found;
}

/** Where the bracket opened at `open` (`(` or `{`) is closed, strings skipped, or -1 when it is not. */
function closingOf(code, open) {
  const pair = code[open] === '(' ? ['(', ')'] : ['{', '}'];
  let depth = 0;
  let quote = null;
  for (let at = open; at < code.length; at += 1) {
    const here = code[at];
    if (quote !== null) {
      if (here === '\\') at += 1;
      else if (here === quote) quote = null;
      continue;
    }
    if (here === '\'' || here === '"' || here === '`') quote = here;
    else if (here === pair[0]) depth += 1;
    else if (here === pair[1]) {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/**
 * The list a `deleteOwnProject(` at `at` keeps its failure in, or undefined
 * when it does not keep it: the call is awaited, sits in the innermost `try`
 * around it, and that try's `catch (<name>)` uses the error and pushes onto a
 * list.
 */
function keptIn(body, at) {
  if (!/\bawait\s+$/.test(body.slice(0, at))) return undefined;
  let inner;
  for (const match of body.matchAll(/\btry\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    if (open > at) break;
    const close = closingOf(body, open);
    if (close > at) inner = close;
  }
  if (inner === undefined) return undefined;
  const caught = /^\s*catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/.exec(body.slice(inner + 1));
  if (caught === null) return undefined;
  const open = inner + caught[0].length;
  const handler = body.slice(open + 1, closingOf(body, open));
  const list = /([A-Za-z_$][\w$]*)\.push\(/.exec(handler)?.[1];
  if (list === undefined || !new RegExp(`\\b${caught[1].replace(/\$/g, '\\$')}\\b`).test(handler)) return undefined;
  return list;
}

/** Whether the teardown asserts each list in `lists` empty after it removes the bots folder, and then does nothing else. */
function assertsLastThatNoneFailed(body, lists) {
  const removed = [...body.matchAll(/\bremoveBotsFolderAndSiblings\(/g)].at(-1)?.index ?? -1;
  let rest = body;
  let first = Infinity;
  for (const list of lists) {
    const found = [...body.matchAll(new RegExp(`\\bassert\\.deepEqual\\(\\s*${list.replace(/\$/g, '\\$')}\\s*,\\s*\\[\\s*\\]`, 'g'))].at(-1);
    if (found === undefined || found.index < removed) return false;
    first = Math.min(first, found.index);
    const end = closingOf(body, found.index + 'assert.deepEqual'.length);
    rest = rest.slice(0, found.index) + ' '.repeat(end + 1 - found.index) + rest.slice(end + 1);
  }
  return /^[\s;})]*$/.test(rest.slice(first));
}

/** What is wrong with one file's teardowns, and with how it removes its projects, as sentences, or none. */
function teardownTrouble(source) {
  const trouble = [];
  const code = withoutComments(source);
  for (const body of teardownsIn(code)) {
    if (/['"]terminal['"],\s*['"]close['"]/.test(body)) trouble.push('its teardown closes a tab itself rather than through guard.closeOwnAt');
    if (/\.handles\.has\(/.test(body)) trouble.push('its teardown picks tabs by whether they were open before the run');
    const owned = [...body.matchAll(/\bdeleteOwnProject\(/g)].map((match) => match.index);
    if (/['"]setup-delete['"]/.test(body) || owned.length > 0) {
      if (!/\bguard\.closeOwnAt\(/.test(body)) trouble.push('its teardown deletes its projects without closing its tabs through guard.closeOwnAt');
      const asserted = body.search(/assert\.deepEqual\(\s*foreign\b/);
      const removed = body.search(/\bremoveBotsFolderAndSiblings\(/);
      if (asserted < 0 || (removed >= 0 && removed < asserted)) trouble.push('its teardown does not assert foreign is empty before it removes the bots folder');
    }
    if (owned.length > 0) {
      const lists = owned.map((at) => keptIn(body, at));
      if (lists.includes(undefined)) trouble.push('its teardown calls deleteOwnProject other than awaited in a try whose catch keeps the failure');
      const kept = [...new Set(lists.filter((list) => list !== undefined))];
      if (kept.length > 0 && !assertsLastThatNoneFailed(body, kept)) trouble.push('its teardown does not assert, last and after it removes the bots folder, that no delete failed');
    }
  }
  if (/setup-delete/.test(code)) trouble.push('it sends setup-delete itself rather than through deleteOwnProject');
  if (/\bdeleteProject\(/.test(code)) trouble.push('it calls deleteProject itself rather than deleteOwnProject');
  return [...new Set(trouble)];
}

// ------------------------------------------------------------- the check's own cases

const GUARDED = `
test('x', async (t) => {
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(homes);
    const held = new Set(foreign.map((one) => one.home));
    const failedDeletes = [];
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
      } catch (error) {
        failedDeletes.push({ path: setup.path, why: error.message });
      }
    }
    assert.deepEqual(foreign, [], 'tabs this test did not create');
    await removeBotsFolderAndSiblings(bots);
    const { closedNotOurs } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove');
  });
  orca(['terminal', 'close', '--terminal', mine, '--tab']);
});
`;

// The guarded teardown as it was before #536: through the guard, and sending
// its own plain setup-delete.
const GUARDED_BEFORE_536 = `
test('x', async (t) => {
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(homes);
    const held = new Set(foreign.map((one) => one.home));
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || held.has(setup.path)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    assert.deepEqual(foreign, [], 'tabs this test did not create');
    await removeBotsFolderAndSiblings(bots);
    const { closedNotOurs } = guard.verdict(before.handles);
  });
  orca(['terminal', 'close', '--terminal', mine, '--tab']);
});
`;

const SWEEP = `
test('x', async (t) => {
  t.after(async () => {
    for (const terminal of terminalsAt(home)) {
      if (before.handles.has(terminal.handle)) continue;
      orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
    }
    for (const setup of allSetups()) orca(['project', 'setup-delete', '--setup', setup.id]);
    await removeBotsFolderAndSiblings(bots);
  });
});
`;

test('the check passes a teardown that closes through the guard, and a close of the test\'s own handle outside it', () => {
  assert.deepEqual(teardownTrouble(GUARDED), []);
});

test('the check names a teardown that sweeps by "not open before", closes tabs itself, and skips the guard', () => {
  assert.deepEqual(teardownTrouble(SWEEP), [
    'its teardown closes a tab itself rather than through guard.closeOwnAt',
    'its teardown picks tabs by whether they were open before the run',
    'its teardown deletes its projects without closing its tabs through guard.closeOwnAt',
    'its teardown does not assert foreign is empty before it removes the bots folder',
    'it sends setup-delete itself rather than through deleteOwnProject',
  ]);
});

test('the check names a guarded teardown that removes the bots folder before it asserts foreign is empty', () => {
  const late = GUARDED.replace(
    "    assert.deepEqual(foreign, [], 'tabs this test did not create');\n    await removeBotsFolderAndSiblings(bots);\n",
    "    await removeBotsFolderAndSiblings(bots);\n    assert.deepEqual(foreign, [], 'tabs this test did not create');\n",
  );
  assert.notEqual(late, GUARDED, 'the premise: the case was rewritten');
  assert.deepEqual(teardownTrouble(late), ['its teardown does not assert foreign is empty before it removes the bots folder']);
});

test('the check is not fooled by comments: a sweep left in a comment is none, and a comment naming the guard is no guard', () => {
  const commentedOut = GUARDED.replace(
    '    const { closed, foreign } = guard.closeOwnAt(homes);\n',
    '    const { closed, foreign } = guard.closeOwnAt(homes);\n'
    + "    // for (const terminal of terminalsAt(home)) { if (before.handles.has(terminal.handle)) continue; orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']); }\n"
    + "    /* orca(['terminal', 'close', '--terminal', stray, '--tab']); */\n",
  );
  assert.deepEqual(teardownTrouble(commentedOut), [], 'a sweep in comments is not code');

  const namedOnly = SWEEP.replace('  t.after(async () => {\n', '  t.after(async () => {\n    // guard.closeOwnAt(homes); assert.deepEqual(foreign, []);\n');
  assert.ok(teardownTrouble(namedOnly).includes('its teardown deletes its projects without closing its tabs through guard.closeOwnAt'), 'a comment naming the guard does not count as the guard');
});

test('the check keeps strings whole: a // inside a string is not a comment, and a paren inside one does not end the teardown', () => {
  const tricky = SWEEP.replace('  t.after(async () => {\n', "  t.after(async () => {\n    t.diagnostic('see https://example.com/a (b');\n");
  assert.ok(teardownTrouble(tricky).includes('its teardown closes a tab itself rather than through guard.closeOwnAt'));
});

// #536: a project goes only through deleteOwnProject, and a failed delete fails
// the teardown only once the rest of it has run.

const KEPT = 'its teardown calls deleteOwnProject other than awaited in a try whose catch keeps the failure';
const LAST = 'its teardown does not assert, last and after it removes the bots folder, that no delete failed';
const SENDS = 'it sends setup-delete itself rather than through deleteOwnProject';
const DIRECT = 'it calls deleteProject itself rather than deleteOwnProject';

/** GUARDED with `from` rewritten as `to`, and the premise that it was. */
function rewritten(from, to) {
  const changed = GUARDED.replace(from, to);
  assert.notEqual(changed, GUARDED, `the premise: the case was rewritten at ${JSON.stringify(from)}`);
  return changed;
}

/** The try around the delete in GUARDED, as it stands. */
const TRY = `      try {
        await deleteOwnProject(setup, bots);
      } catch (error) {
        failedDeletes.push({ path: setup.path, why: error.message });
      }
`;

/** The assert that no delete failed in GUARDED, which ends its teardown. */
const NONE_FAILED = "    assert.deepEqual(failedDeletes, [], 'projects this test could not remove');\n";

test('the check is not fooled by a quote in a regular expression: comments after it are still comments, and a teardown still ends where it ends', () => {
  const regex = 'const id = /"requestId"\\s*:\\s*"([^"]+)"/.exec(text);\n';
  const before = `${regex}// orca(['project', 'setup-delete', '--setup', id]);\n${GUARDED}`;
  assert.deepEqual(teardownTrouble(before), [], 'a setup-delete in a comment after the regex is still a comment');

  const inside = rewritten('    const failedDeletes = [];\n', `    const failedDeletes = [];\n    ${regex}`);
  assert.deepEqual(teardownTrouble(`${inside}${GUARDED_BEFORE_536.replace(/setup-delete/, 'setup-list')}`), [], 'the teardown ends at its own close, so its last assert is last');

  const division = rewritten('    const failedDeletes = [];\n', '    const failedDeletes = [];\n    const half = total / 2; const rest = (total) / 2;\n');
  assert.deepEqual(teardownTrouble(division), [], 'a division is not a regular expression');
});

test('the check takes a division after a postfix ++ or --, or after a property named like a keyword, for a division: a setup-delete after it on the line is still named', () => {
  // Found in the review of PR #546: each of these was read as the start of a
  // regular expression, which swallowed the rest of the line and hid the delete.
  for (const division of ['n++ / 2', 'n-- / 2', 'obj.in / 2', 'obj.return / 2', 'obj.of / 2', 'obj?.typeof / 2', '$in / 2']) {
    const line = `let n = 8; const half = ${division}; orca(["project", "setup-delete", "--setup", id]);\n`;
    assert.deepEqual(teardownTrouble(`${line}${GUARDED}`), [SENDS], `after \`${division}\``);
  }
  const keyword = 'const id = typeof /"requestId"/.exec(text); const back = () => { return /"x"/; };\n// orca([\'project\', \'setup-delete\', \'--setup\', id]);\n';
  assert.deepEqual(teardownTrouble(`${keyword}${GUARDED}`), [], 'after a keyword itself it is still a regular expression');
});

test('the check names a guarded teardown that still sends its own setup-delete, and only for that', () => {
  assert.deepEqual(teardownTrouble(GUARDED_BEFORE_536), [SENDS]);
});

test('the check names setup-delete sent anywhere in a system test, in a test body or a helper too, but not in a comment', () => {
  const inBody = rewritten(
    "  orca(['terminal', 'close', '--terminal', mine, '--tab']);\n",
    "  orca(['terminal', 'close', '--terminal', mine, '--tab']);\n  orca(['project', 'setup-delete', '--setup', id, '--force']);\n",
  );
  assert.deepEqual(teardownTrouble(inBody), [SENDS]);

  const inHelper = `function removeIt(id) {\n  return orca(['project', "setup-delete", '--setup', id]);\n}\n${GUARDED}`;
  assert.deepEqual(teardownTrouble(inHelper), [SENDS]);

  const commented = `// orca(['project', 'setup-delete', '--setup', id]);\n/* 'setup-delete' */\n${GUARDED}`;
  assert.deepEqual(teardownTrouble(commented), [], 'a setup-delete in a comment is not code');
});

test('the check names a system test that calls src/orca.js\'s deleteProject itself, in a teardown or anywhere else', () => {
  const inTeardown = rewritten('        await deleteOwnProject(setup, bots);\n', '        await deleteOwnProject(setup, bots);\n        deleteProject(setup.id);\n');
  assert.deepEqual(teardownTrouble(inTeardown), [DIRECT]);

  const inBody = rewritten("  orca(['terminal', 'close', '--terminal', mine, '--tab']);\n", '  deleteProject(setupId);\n');
  assert.deepEqual(teardownTrouble(inBody), [DIRECT]);

  assert.deepEqual(teardownTrouble(`// deleteProject(setup.id);\n${GUARDED}`), [], 'not in a comment');
});

test('a teardown that removes its projects through deleteOwnProject is held to the guard\'s rules as a setup-delete one is', () => {
  const unguarded = rewritten('    const { closed, foreign } = guard.closeOwnAt(homes);\n', '    const { closed, foreign } = closeAt(homes);\n');
  assert.deepEqual(teardownTrouble(unguarded), ['its teardown deletes its projects without closing its tabs through guard.closeOwnAt']);

  const late = rewritten(
    "    assert.deepEqual(foreign, [], 'tabs this test did not create');\n    await removeBotsFolderAndSiblings(bots);\n",
    "    await removeBotsFolderAndSiblings(bots);\n    assert.deepEqual(foreign, [], 'tabs this test did not create');\n",
  );
  assert.deepEqual(teardownTrouble(late), ['its teardown does not assert foreign is empty before it removes the bots folder']);

  const unasserted = rewritten("    assert.deepEqual(foreign, [], 'tabs this test did not create');\n", '');
  assert.deepEqual(teardownTrouble(unasserted), ['its teardown does not assert foreign is empty before it removes the bots folder']);
});

test('the check names a deleteOwnProject that is not awaited inside a try whose catch keeps the failure', () => {
  const bare = rewritten(TRY, '      await deleteOwnProject(setup, bots);\n');
  assert.ok(teardownTrouble(bare).includes(KEPT), `no try at all: ${teardownTrouble(bare)}`);

  const notAwaited = rewritten('        await deleteOwnProject(setup, bots);\n', '        deleteOwnProject(setup, bots);\n');
  assert.deepEqual(teardownTrouble(notAwaited), [KEPT], 'a promise left unawaited is a failure no catch sees');

  const swallowed = rewritten(TRY, '      try {\n        await deleteOwnProject(setup, bots);\n      } catch {\n        // left\n      }\n');
  assert.ok(teardownTrouble(swallowed).includes(KEPT), `a catch with no error: ${teardownTrouble(swallowed)}`);

  const dropped = rewritten(
    '        failedDeletes.push({ path: setup.path, why: error.message });\n',
    "        t.diagnostic(`could not remove ${setup.path}: ${error.message}`);\n",
  );
  assert.ok(teardownTrouble(dropped).includes(KEPT), `a catch that only says it: ${teardownTrouble(dropped)}`);

  const errorUnused = rewritten(
    '        failedDeletes.push({ path: setup.path, why: error.message });\n',
    '        failedDeletes.push(setup.path);\n',
  );
  assert.deepEqual(teardownTrouble(errorUnused), [KEPT], 'a catch that drops why the delete failed');

  const finallyOnly = rewritten(TRY, '      try {\n        await deleteOwnProject(setup, bots);\n      } finally {\n        failedDeletes.push(setup.path);\n      }\n');
  assert.ok(teardownTrouble(finallyOnly).includes(KEPT), `a try with no catch: ${teardownTrouble(finallyOnly)}`);

  const outsideTheTry = rewritten(TRY, `${TRY}      await deleteOwnProject(setup, bots);\n`);
  assert.deepEqual(teardownTrouble(outsideTheTry), [KEPT], 'every call, not just the first');

  const tryElsewhere = rewritten(
    TRY,
    '      try {\n        reloadWindow();\n      } catch (error) {\n        failedDeletes.push(error.message);\n      }\n      await deleteOwnProject(setup, bots);\n',
  );
  assert.deepEqual(teardownTrouble(tryElsewhere), [KEPT], 'a try that closed before the call does not hold it');
});

test('the check passes a try whose catch keeps the failure under any names', () => {
  const renamed = GUARDED
    .replaceAll('failedDeletes', 'notRemoved')
    .replace('} catch (error) {', '} catch (refusal) {')
    .replace('why: error.message', 'why: refusal.message');
  assert.notEqual(renamed, GUARDED);
  assert.deepEqual(teardownTrouble(renamed), []);
});

test('the check names a teardown that asserts no delete failed before it removes the bots folder, or before anything else it does', () => {
  const early = rewritten(NONE_FAILED, '').replace(
    '    await removeBotsFolderAndSiblings(bots);\n',
    `${NONE_FAILED}    await removeBotsFolderAndSiblings(bots);\n`,
  );
  assert.deepEqual(teardownTrouble(early), [LAST], 'before the bots folder goes');

  const beforeTheVerdict = rewritten(NONE_FAILED, '').replace(
    '    const { closedNotOurs } = guard.verdict(before.handles);\n',
    `${NONE_FAILED}    const { closedNotOurs } = guard.verdict(before.handles);\n`,
  );
  assert.deepEqual(teardownTrouble(beforeTheVerdict), [LAST], 'after the bots folder, but with more of the teardown still to run');

  const never = rewritten(NONE_FAILED, '');
  assert.deepEqual(teardownTrouble(never), [LAST], 'failures kept and never asserted');

  const otherList = rewritten(NONE_FAILED, "    assert.deepEqual(closed, [], 'what it closed');\n");
  assert.deepEqual(teardownTrouble(otherList), [LAST], 'an empty assert of another list is not the one');

  const notEmpty = rewritten(NONE_FAILED, "    assert.ok(failedDeletes, 'projects this test could not remove');\n");
  assert.deepEqual(teardownTrouble(notEmpty), [LAST], 'it has to say the list is empty');
});

test('the check passes two kept lists asserted together at the end, in either order', () => {
  const two = rewritten(
    '    const failedDeletes = [];\n',
    '    const failedDeletes = [];\n    const failedOthers = [];\n    try {\n      await deleteOwnProject(extra, bots);\n    } catch (error) {\n      failedOthers.push(error.message);\n    }\n',
  );
  const both = two.replace(NONE_FAILED, `${NONE_FAILED}    assert.deepEqual(failedOthers, [], 'the other projects');\n`);
  assert.deepEqual(teardownTrouble(both), []);
  const swapped = two.replace(NONE_FAILED, `    assert.deepEqual(failedOthers, [], 'the other projects');\n${NONE_FAILED}`);
  assert.deepEqual(teardownTrouble(swapped), []);
  assert.deepEqual(teardownTrouble(two), [LAST], 'one of the two left unasserted');
});

// ------------------------------------------------------------- the system tests

test('every system test\'s teardown closes only its own tabs, through the tab guard', async () => {
  const tree = await snapshot(systemTestsDir);
  const files = Object.keys(tree).filter((rel) => tree[rel].startsWith('file:') && rel.endsWith('.js'));
  assert.ok(files.length > 0, 'there should be system tests to check');

  const found = [];
  let teardowns = 0;
  for (const rel of files.sort()) {
    const source = await readFile(path.join(systemTestsDir, rel), 'utf8');
    teardowns += teardownsIn(withoutComments(source)).length;
    for (const why of teardownTrouble(source)) found.push(`test/system/${rel}: ${why}`);
  }
  assert.ok(teardowns > 0, 'no teardown was found in the system tests, so the check sees nothing');
  assert.deepEqual(found, [], `system tests whose teardown does not go through the tab guard:\n  ${found.join('\n  ')}`);
});
