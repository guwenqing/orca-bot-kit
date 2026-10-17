// The PRD and AGENTS.md give one answer on AssuredLoop (#574). The owner
// adopted AssuredLoop on 2026-10-03 (#474), and AGENTS.md has required it since:
// the `al` CLI, `al context`, `al check --strict` in CI. But the PRD's "What we
// are not doing" still said "No AssuredLoop". AGENTS.md names the PRD as the
// design, so a contributor who read both got two answers.
//
// What can break is that the old line comes back, or that the PRD never says
// AssuredLoop is used, or that the fix takes OpenSpec and the other process
// frameworks out of "What we are not doing" with it: the owner reversed only
// the AssuredLoop part.
//
// The words of the PRD are not pinned, and what its prose means is left to the
// review. The checks here are of structure only. A line rules AssuredLoop out
// when, in one clause, AssuredLoop follows a "no", "not" or "never" with no
// "other than", "besides", "except", "apart from" or "but" between them, or
// when AssuredLoop "is not" or "is never". A line records the use when it
// names AssuredLoop, does not rule it out, and names its source (#474 or
// 2026-10-03). The npm scope `@assuredloop/` in the package name is not the
// framework.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from './helpers/cli.js';

const PRD = 'docs/prd/prd.md';
const NOT_DOING = /^## .*What we are not doing/m;

const readText = (rel) => readFile(path.join(repoRoot, rel), 'utf8');

/** The section of a markdown text whose `## ` heading matches, down to the next `## ` heading, or null. */
function sectionOf(text, heading) {
  const start = text.search(heading);
  if (start < 0) return null;
  const rest = text.slice(start + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? text.slice(start) : text.slice(start, start + 1 + end);
}

/** The `- ` bullets of a text, one string each, with their continuation lines. */
function bulletsOf(text) {
  const bullets = [];
  for (const line of text.split('\n')) {
    if (/^- /.test(line)) bullets.push(line.slice(2));
    else if (bullets.length > 0 && /^\s+\S/.test(line)) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  return bullets;
}

/** A text without the npm scope `@assuredloop/`, which names a package and not the framework. */
const withoutScope = (text) => text.replace(/@assuredloop\//gi, '');

/** Whether a text names AssuredLoop the framework. */
const namesAssuredLoop = (text) => /\bAssuredLoop\b/i.test(withoutScope(text));

/** The clauses of a line: its parts between brackets and a `.`, `;` or `:` that ends a word. */
const clausesOf = (line) => withoutScope(line).split(/[.;:](?=\s|$)|[[\]()]/);

/** Words that negate what follows them in a clause. */
const NEGATION = /\b(?:no|not|never)\b/gi;
/** Words that take what follows them out of a negation: "no framework other than X". */
const EXCEPTION = /\b(?:other than|besides|except|apart from|but)\b/i;
/** A negation just after the name: "AssuredLoop is not used". */
const NEGATED_AFTER = /^\s*(?:(?:is|was|stays|remains)\s+(?:not|never|no longer)|isn't)\b/i;

/** Whether a clause negates the AssuredLoop that starts at an index of it. */
function negatesAt(clause, index, length) {
  const before = clause.slice(0, index);
  const negations = [...before.matchAll(NEGATION)];
  const last = negations.at(-1);
  if (last !== undefined && !EXCEPTION.test(before.slice(last.index))) return true;
  return NEGATED_AFTER.test(clause.slice(index + length));
}

/** Whether a line says AssuredLoop is not used here. */
const rulesOutAssuredLoop = (line) =>
  clausesOf(line).some((clause) => [...clause.matchAll(/\bAssuredLoop\b/gi)].some((match) => negatesAt(clause, match.index, match[0].length)));

/** Whether a line names the owner's decision to adopt AssuredLoop: #474 or 2026-10-03. */
const citesTheDecision = (line) => /#474\b|2026-10-03/.test(line);

/** Whether a line records that AssuredLoop is used here, by the owner's decision. */
const recordsTheUse = (line) => namesAssuredLoop(line) && !rulesOutAssuredLoop(line) && citesTheDecision(line);

/** The AssuredLoop section of AGENTS.md, or null when it has none. */
async function agentsAssuredLoop() {
  return sectionOf(await readText('AGENTS.md'), /^## .*AssuredLoop/m);
}

/** The "What we are not doing" section of the PRD; it has to be there. */
async function notDoing() {
  const section = sectionOf(await readText(PRD), NOT_DOING);
  assert.ok(section !== null, `${PRD} should keep its "What we are not doing" section`);
  return section;
}

test('the PRD does not rule out AssuredLoop while AGENTS.md requires it', async (t) => {
  if ((await agentsAssuredLoop()) === null) {
    t.skip('AGENTS.md has no AssuredLoop section, so there is nothing to agree with');
    return;
  }
  const outlawing = bulletsOf(await notDoing()).filter(rulesOutAssuredLoop);
  assert.deepEqual(
    outlawing,
    [],
    'a contributor reads in the PRD\'s "What we are not doing" that AssuredLoop is not used, ' +
      'while AGENTS.md requires it (#474)',
  );
  const elsewhere = (await readText(PRD)).split('\n').filter(rulesOutAssuredLoop);
  assert.deepEqual(elsewhere, [], 'a contributor reads in the PRD that AssuredLoop is not used, while AGENTS.md requires it (#474)');
});

test('the PRD records that AssuredLoop is used here, by the owner\'s decision', async (t) => {
  if ((await agentsAssuredLoop()) === null) {
    t.skip('AGENTS.md has no AssuredLoop section, so there is nothing to agree with');
    return;
  }
  const lines = (await readText(PRD)).split('\n');
  const records = lines.filter(recordsTheUse);
  assert.ok(
    records.length > 0,
    'a contributor finds nothing in the PRD that says AssuredLoop is used in this repo, ' +
      'and the owner\'s decision (2026-10-03, #474) is not recorded there',
  );
});

test('OpenSpec and other process frameworks stay out of this repo', async () => {
  const outOfScope = bulletsOf(await notDoing()).filter((bullet) => /\bOpenSpec\b/.test(bullet) && /^No\b/.test(bullet));
  assert.ok(
    outOfScope.length > 0,
    'a contributor no longer reads in the PRD\'s "What we are not doing" that OpenSpec is not used; ' +
      'the owner reversed only the AssuredLoop part (#474)',
  );
  assert.ok(
    outOfScope.some((bullet) => /process framework/i.test(bullet)),
    'a contributor no longer reads in the PRD that other process frameworks stay out; ' +
      'only AssuredLoop was let in (#474)',
  );
});

/** A line that still bans AssuredLoop, though it has a "Use" and the decision's source in it. */
const BANS_WITH_USE =
  'No AssuredLoop, OpenSpec or other process framework in this repo for now. Use AGENTS.md for the process. ' +
  '[decided by the owner, 2026-10-03, #474]';
/** A line that lets AssuredLoop in and keeps the rest out, with "uses" in it. */
const LETS_IN_WITH_USES =
  'No process framework in this repo other than AssuredLoop, for now: no OpenSpec or the like. ' +
  'This repo uses AssuredLoop to keep its requests and its spec, this PRD; AGENTS.md says how. ' +
  '[decided by the owner, 2026-10-03, #474]';
/** A line that lets AssuredLoop in and keeps the rest out, with no "use" or "adopt" in it. */
const LETS_IN_WITHOUT_USE =
  'No process framework in this repo other than AssuredLoop, for now: no OpenSpec or the like. ' +
  'AssuredLoop keeps this repo\'s requests and its spec, this PRD, and AGENTS.md says how. ' +
  '[decided by the owner, 2026-10-03, #474]';

test('the rules here tell a line that rules AssuredLoop out from one that records its use', () => {
  assert.ok(rulesOutAssuredLoop('No AssuredLoop, OpenSpec or other process framework in this repo for now. [decided]'));
  assert.ok(rulesOutAssuredLoop(BANS_WITH_USE));
  assert.ok(!recordsTheUse(BANS_WITH_USE));
  for (const line of [LETS_IN_WITH_USES, LETS_IN_WITHOUT_USE]) {
    assert.ok(!rulesOutAssuredLoop(line), line);
    assert.ok(recordsTheUse(line), line);
  }
  assert.ok(rulesOutAssuredLoop('AssuredLoop is not used here.'));
  assert.ok(!rulesOutAssuredLoop('No OpenSpec or other process framework besides AssuredLoop, which this repo uses (#474).'));
  assert.ok(!rulesOutAssuredLoop('Installed with `npm install -g @assuredloop/orca-bot-kit`.'));
  assert.ok(!namesAssuredLoop('The npm package is `@assuredloop/orca-bot-kit`.'));
  assert.ok(citesTheDecision('AssuredLoop is used (#474).'));
  assert.ok(!citesTheDecision('AssuredLoop is used (#4740).'));
});
