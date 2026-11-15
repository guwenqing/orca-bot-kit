// The list in README.md of the kit's rule units that every bot carries (issue
// #756). A reader learns from it what a new bot is given without asking, so it
// must name each kit unit whose frontmatter says `applies: all`, and no other,
// and the sentence before it must count them right. It went stale once: two
// units joined rules/ and the README still said nine. This test reads both
// sides out of the files, so a unit added to rules/, taken out, or moved
// between `all` and `code` fails here until the README says so too.
//
// What is held is the set of names and the count word, nothing more. The
// description beside each name and the paragraph on the code-only units are
// prose, and are the writer's. The list is found by what it says (the sentence,
// then the table after it) inside its section, not by where it sits.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from './helpers/cli.js';
import { defaultUnits } from './helpers/rules.js';

const SECTION = '## The rules a bot works by';
const SENTENCE = /^(\S+) units suit every bot, whatever it does:$/;

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three',
  'twenty-four', 'twenty-five',
];

/**
 * The lines of one `## ` section of the README, without its heading. A `## `
 * line inside a ``` fence is an example, not the next section: the section
 * itself shows a built AGENTS.md with a `## Charter` in it.
 */
function sectionLines(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `README.md should have the section ${JSON.stringify(heading)}`);
  const rest = lines.slice(start + 1);
  let fenced = false;
  const end = rest.findIndex((line) => {
    if (line.startsWith('```')) fenced = !fenced;
    return !fenced && /^## /.test(line);
  });
  return end === -1 ? rest : rest.slice(0, end);
}

/** The count word of the sentence, and the unit names of the table after it. */
function listIn(text) {
  const lines = sectionLines(text, SECTION);
  const at = lines.flatMap((line, index) => (SENTENCE.test(line) ? [index] : []));
  assert.equal(
    at.length,
    1,
    `the section ${JSON.stringify(SECTION)} should have one line "<Count> units suit every bot, whatever it does:", got ${at.length}`,
  );
  const word = SENTENCE.exec(lines[at[0]])[1];

  const after = lines.slice(at[0] + 1);
  const first = after.findIndex((line) => line.startsWith('|'));
  assert.notEqual(first, -1, 'a table should follow the sentence "... units suit every bot, whatever it does:"');
  const gap = after.slice(0, first).filter((line) => line.trim() !== '');
  assert.deepEqual(gap, [], 'the table should come straight after the sentence, with only blank lines between');
  const table = after.slice(first);
  const stop = table.findIndex((line) => !line.startsWith('|'));
  const rows = stop === -1 ? table : table.slice(0, stop);

  const names = rows.map((row) => /^\|\s*`([^`]+)`\s*\|/.exec(row)).filter((found) => found !== null).map((found) => found[1]);
  return { word, names };
}

/** Both sides, read fresh from the files: the README's list and the kit's applies: all units. */
async function bothSides() {
  const text = await readFile(path.join(repoRoot, 'README.md'), 'utf8');
  const expected = (await defaultUnits()).map((unit) => unit.name);
  assert.notEqual(expected.length, 0, 'rules/ should hold at least one applies: all unit');
  return { ...listIn(text), expected };
}

test('the README table names every applies: all kit unit, once each, and no other', async () => {
  const { names, expected } = await bothSides();

  const twice = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  const missing = expected.filter((name) => !names.includes(name));
  const extra = [...new Set(names.filter((name) => !expected.includes(name)))];
  assert.deepEqual(
    { missing, extra, twice },
    { missing: [], extra: [], twice: [] },
    `the README table should name exactly the applies: all kit units (${expected.join(', ')}); `
      + `missing: [${missing.join(', ')}], extra: [${extra.join(', ')}], listed twice: [${twice.join(', ')}]`,
  );
});

test('the sentence before the README table counts the applies: all kit units right', async () => {
  const { word, expected } = await bothSides();
  const count = WORDS.indexOf(word.toLowerCase());
  assert.notEqual(count, -1, `the count word ${JSON.stringify(word)} should be an English number word from zero to ${WORDS.at(-1)}`);
  assert.equal(
    count,
    expected.length,
    `the sentence says "${word} units" but rules/ has ${expected.length} applies: all units (${WORDS[expected.length] ?? expected.length})`,
  );
});
