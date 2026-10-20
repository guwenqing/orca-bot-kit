// The PRD as a spec that AssuredLoop 1.0.0 reads (#667). al 1.0.0 reads a spec
// doc by its paragraphs. Each paragraph has a hidden marker on its own line
// right before it, with a blank line before and after the marker:
//
//   <!-- PRD-41 rule serves:some-request/R2 builds-on:PRD-12 -->
//
//   The paragraph's text.
//
// The marker holds the paragraph's ID (a prefix and a number), its kind, and
// its links. A heading is a paragraph too, of the kind note. An ID is used
// once in the file.
//
// What a paragraph is, is al's rule, read from its package at 1.0.0
// (src/v4/markers.js, blocksOf): a heading is a paragraph of its own, and so is
// the text right after it. A list, a table, a quote, an indented line or a
// fence belongs to the paragraph before it, also after a blank line. Fenced
// code is not read for markers. The test reads the PRD by the same rule, and
// does not run al.
//
// What the test leaves to the review: which kind each paragraph has, which
// links it gives, and which prefix the IDs take. These are judgements, and al
// itself does not check them. That the markers and kinds are the only change
// to the PRD is a property of the change, not of the repo, and is left to the
// review of the diff: a test of it would forbid every later edit of the PRD.
//
// The PRD's headings keep their text, the `[PRD-n]` tag included, because
// other files link to them and cite them by that tag. prd-baseline.test.js
// checks the links. This file checks the citations.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { repoRoot, snapshot } from './helpers/cli.js';

const PRD = 'docs/prd/prd.md';
const CONFIG = '.assuredloop/config.yaml';
const SCHEMA = '.assuredloop/schema.yaml';

/** This file, which names IDs and tags in its worked examples. */
const THIS_FILE = path.relative(repoRoot, fileURLToPath(import.meta.url)).split(path.sep).join('/');

/** The kinds al 1.0.0 knows, by group (its README, "The model in one page"). */
const KINDS = {
  promise: ['purpose', 'scope', 'rule', 'limit', 'definition'],
  design: ['component', 'interface', 'data', 'flow', 'choice'],
  approach: ['approach'],
  informative: ['rationale', 'example', 'open'],
  note: ['note'],
  'change-only': ['plan', 'step', 'migration'],
};
const ALL_KINDS = new Set(Object.values(KINDS).flat());

/** The link words al 1.0.0 reads in a marker, each as `<word>:<target>`. */
const LINK_WORDS = new Set([
  'serves', 'builds-on', 'changes', 'removes', 'explains', 'illustrates', 'resolved-by',
  'governed-by', 'decides', 'for', 'supersedes', 'source',
]);

/** A marker line: `<!--`, a space, the ID, the other words, a space, `-->`. */
const MARKER = /^<!--[ \t]+([A-Z][A-Z0-9]*-[0-9]+)((?:[ \t]+\S+)*?)[ \t]+-->[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+.*)?$/;

/** A GFM table's delimiter row, such as `--- | ---` or `|:--|--:|`. */
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const cells = (row) => row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).length;
const tableStart = (line, next) => line.includes('|') && next.includes('|') && DELIMITER.test(next) && cells(line) === cells(next);

/**
 * Whether a line belongs to the paragraph before it, also after a blank line:
 * a list item, the start of a table, a quote, an indented line or a fence.
 */
const continues = (line, next = '') => /^\s*([-*+]|\d+[.)])(\s|$)/.test(line) || tableStart(line, next)
  || /^\s*>/.test(line) || /^\s+\S/.test(line) || FENCE.test(line);

/**
 * The paragraphs of a Markdown text, each { line, text, heading, marked }:
 * `line` is the number of its first line, `marked` whether a marker line comes
 * right before it, with only blank lines between. Fenced code belongs to the
 * paragraph it is in, and is not read for markers or headings.
 */
function paragraphsOf(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paragraphs = [];
  let fence = null;
  let blank = true;
  let open = false;
  let afterHeading = false;
  let marked = false;
  lines.forEach((line, at) => {
    if (fence !== null) {
      const close = FENCE.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && line.trim() === close[1]) fence = null;
      return;
    }
    if (MARKER.test(line)) {
      marked = true;
      open = false;
      afterHeading = false;
      blank = true;
      return;
    }
    if (line.trim() === '') { blank = true; return; }
    const heading = HEADING.test(line);
    if (!open || heading || afterHeading || (blank && !continues(line, lines[at + 1]))) {
      paragraphs.push({ line: at + 1, text: line.trim(), heading, marked });
      marked = false;
      open = true;
    }
    const opens = FENCE.exec(line);
    if (opens) fence = opens[1];
    afterHeading = heading;
    blank = false;
  });
  return paragraphs;
}

/**
 * The marker lines of a Markdown text outside fenced code, each { line, id,
 * kinds, links, others, blankBefore, blankAfter, paragraph }: `kinds` the words
 * with no colon, `links` the `<word>:<target>` words, `others` the words with a
 * colon whose word is not a link word, `paragraph` the paragraph right after
 * it, or null when another marker or the end of the text comes first.
 */
function markersOf(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const starts = new Map(paragraphsOf(text).map((paragraph) => [paragraph.line, paragraph]));
  const markers = [];
  let fence = null;
  lines.forEach((line, at) => {
    if (fence !== null) {
      const close = FENCE.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && line.trim() === close[1]) fence = null;
      return;
    }
    const match = MARKER.exec(line);
    if (match === null) {
      const opens = FENCE.exec(line);
      if (opens) fence = opens[1];
      return;
    }
    const words = match[2].trim().split(/[ \t]+/).filter(Boolean);
    let next = at + 1;
    while (next < lines.length && lines[next].trim() === '') next += 1;
    markers.push({
      line: at + 1,
      id: match[1],
      kinds: words.filter((word) => !word.includes(':')),
      links: words.filter((word) => word.includes(':') && LINK_WORDS.has(word.slice(0, word.indexOf(':')))),
      others: words.filter((word) => word.includes(':') && !LINK_WORDS.has(word.slice(0, word.indexOf(':')))),
      blankBefore: at === 0 || lines[at - 1].trim() === '',
      blankAfter: at + 1 < lines.length && lines[at + 1].trim() === '' && next < lines.length,
      paragraph: starts.get(next + 1) ?? null,
    });
  });
  return markers;
}

/** The lines of a text that start like a comment but are not a marker al reads. */
const nearMarkersIn = (text) => text.split('\n')
  .map((line, at) => ({ line: at + 1, text: line }))
  .filter(({ text: line }) => /^\s*<!--/.test(line) && !MARKER.test(line));

const readText = (rel) => readFile(path.join(repoRoot, rel), 'utf8');

/** A YAML file of the repo as a map; the test fails, with a plain message, when it is missing or not a map. */
async function readYamlMap(rel) {
  const text = await readText(rel).catch(() => null);
  assert.ok(text !== null, `${rel} should be a file`);
  const value = parse(text);
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${rel} should be a YAML map`);
  return value;
}

/** The PRD's paragraphs and markers, with a line of the PRD for each message. */
async function prd() {
  const text = await readText(PRD);
  return { text, paragraphs: paragraphsOf(text), markers: markersOf(text) };
}

const where = (line, text) => `${PRD}:${line}: ${text.length > 70 ? `${text.slice(0, 70)}…` : text}`;

// ------------------------------------------------------------- the readers, on worked examples

test('the paragraph reader splits at headings and blank lines, and keeps a list, a table and a fence with the paragraph before them', () => {
  const firsts = (text) => paragraphsOf(text).map((paragraph) => paragraph.text);
  assert.deepEqual(firsts('# Title\n\nOne.\nStill one.\n\nTwo.\n'), ['# Title', 'One.', 'Two.']);
  assert.deepEqual(firsts('## A heading\nText right after it.\n'), ['## A heading', 'Text right after it.'], 'the text right after a heading is a paragraph of its own');
  assert.deepEqual(firsts('Items:\n\n- one\n- two\n\n1. three\n'), ['Items:'], 'a list belongs to the paragraph before it, also after a blank line');
  assert.deepEqual(firsts('A table:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'), ['A table:'], 'a table belongs to the paragraph before it');
  assert.deepEqual(firsts('Code:\n\n```\n# not a heading\n\nnot a paragraph\n```\n\nAfter.\n'), ['Code:', 'After.'], 'fenced code is read for nothing');
  assert.deepEqual(firsts('A quote:\n\n> quoted\n'), ['A quote:'], 'a quote belongs to the paragraph before it');
  assert.deepEqual(firsts('- a list with nothing before it\n'), ['- a list with nothing before it'], 'a list first in the text is a paragraph');
  assert.deepEqual(firsts(''), []);
});

test('the paragraph reader sees a marker right before a paragraph, and not one with a paragraph between', () => {
  const marks = (text) => paragraphsOf(text).map((paragraph) => [paragraph.text, paragraph.marked]);
  assert.deepEqual(
    marks('<!-- PRD-1 note -->\n\n# Title\n\n<!-- PRD-2 rule -->\n\nOne.\n\nTwo.\n'),
    [['# Title', true], ['One.', true], ['Two.', false]],
  );
  assert.deepEqual(marks('<!-- PRD-1 rule -->\nRight under it.\n'), [['Right under it.', true]], 'with no blank line between, it is still the marker of that paragraph');
  assert.deepEqual(
    marks('One.\n\n<!-- PRD-3 rule -->\n\n- an item after the marker\n'),
    [['One.', false], ['- an item after the marker', true]],
    'a marker ends the paragraph before it, so a list after a marker is a paragraph of its own',
  );
  assert.deepEqual(marks('```\n<!-- PRD-4 rule -->\n```\n\nAfter.\n'), [['```', false], ['After.', false]], 'a marker in fenced code is not a marker');
  assert.deepEqual(marks('<!--PRD-5 rule-->\n\nText.\n'), [['<!--PRD-5 rule-->', false], ['Text.', false]], 'with no space inside the comment, al does not read it as a marker');
  assert.deepEqual(marks('<!-- prd-6 rule -->\n\nText.\n'), [['<!-- prd-6 rule -->', false], ['Text.', false]], 'a prefix in lower case is not an ID');
});

test('the marker reader gives each marker its ID, kinds, links, blank lines and paragraph', () => {
  const [first, second, third] = markersOf('<!-- PRD-41 rule serves:a-request/R2 builds-on:PRD-12 -->\n\nThe text.\n\n<!-- PRD-42 -->\n\n<!-- PRD-43 note wrong:x -->\n## A heading\n');
  assert.equal(first.id, 'PRD-41');
  assert.deepEqual(first.kinds, ['rule']);
  assert.deepEqual(first.links, ['serves:a-request/R2', 'builds-on:PRD-12']);
  assert.deepEqual(first.others, []);
  assert.equal(first.blankBefore, true, 'the first line of the text needs nothing before it');
  assert.equal(first.blankAfter, true);
  assert.equal(first.paragraph?.text, 'The text.');

  assert.equal(second.id, 'PRD-42');
  assert.deepEqual(second.kinds, [], 'a marker with no kind');
  assert.equal(second.paragraph, null, 'another marker comes before any paragraph');

  assert.deepEqual(third.kinds, ['note']);
  assert.deepEqual(third.others, ['wrong:x'], 'a word with a colon that is not a link word');
  assert.equal(third.blankAfter, false, 'the heading is right under it');
  assert.equal(third.paragraph?.heading, true);

  const [last] = markersOf('Text.\n<!-- INV-1 rule -->');
  assert.equal(last.blankBefore, false);
  assert.equal(last.blankAfter, false, 'the end of the text is not a blank line');
  assert.deepEqual(nearMarkersIn('<!-- PRD-1 note -->\n<!--PRD-2 rule-->\n<!-- a comment -->\ntext\n').map((line) => line.line), [2, 3]);
});

// ------------------------------------------------------------- the PRD

test('every paragraph of the PRD, each heading included, has a marker right before it', async () => {
  const { text, paragraphs } = await prd();
  assert.ok(paragraphs.length > 0, `${PRD} should have paragraphs`);
  const unmarked = paragraphs.filter((paragraph) => !paragraph.marked).map((paragraph) => where(paragraph.line, paragraph.text));
  const near = nearMarkersIn(text).map((line) => `${where(line.line, line.text)} (looks like a marker, but al does not read it as one)`);
  assert.deepEqual(
    unmarked,
    [],
    `${unmarked.length} of ${paragraphs.length} paragraphs have no marker \`<!-- <PREFIX>-<n> <kind> -->\` on the line before them${near.length > 0 ? `\nLines that start a comment but are no marker:\n${near.join('\n')}` : ''}`,
  );
});

test('each marker in the PRD has a blank line before it and after it, and a paragraph after it', async () => {
  const { markers } = await prd();
  const problems = [];
  for (const marker of markers) {
    if (!marker.blankBefore) problems.push(`${where(marker.line, marker.id)}: no blank line before the marker`);
    if (!marker.blankAfter) problems.push(`${where(marker.line, marker.id)}: no blank line after the marker`);
    if (marker.paragraph === null) problems.push(`${where(marker.line, marker.id)}: no paragraph after the marker`);
  }
  assert.deepEqual(problems, []);
});

test('the IDs in the PRD are each used once', async () => {
  const { markers } = await prd();
  const seen = new Map();
  const problems = [];
  for (const marker of markers) {
    if (seen.has(marker.id)) problems.push(`${where(marker.line, marker.id)}: also used on line ${seen.get(marker.id)}`);
    else seen.set(marker.id, marker.line);
  }
  assert.deepEqual(problems, []);
});

test('each marker in the PRD gives one kind that al 1.0.0 knows, and links only in the words al 1.0.0 reads', async () => {
  const { markers } = await prd();
  const problems = [];
  for (const marker of markers) {
    if (marker.kinds.length !== 1) problems.push(`${where(marker.line, marker.id)}: gives ${marker.kinds.length} kinds (${marker.kinds.join(', ')}); a paragraph has one`);
    for (const kind of marker.kinds.filter((word) => !ALL_KINDS.has(word))) problems.push(`${where(marker.line, marker.id)}: "${kind}" is not a kind of al 1.0.0`);
    for (const word of marker.others) problems.push(`${where(marker.line, marker.id)}: "${word}" is not a link of al 1.0.0`);
  }
  assert.deepEqual(problems, [], `the kinds are ${[...ALL_KINDS].join(', ')}; the link words are ${[...LINK_WORDS].join(', ')}`);
});

test('the marker of each heading in the PRD gives the kind note', async () => {
  const { markers } = await prd();
  const headings = markers.filter((marker) => marker.paragraph?.heading);
  assert.ok(headings.length > 0, `${PRD} should have headings with markers`);
  const problems = headings
    .filter((marker) => marker.kinds.length !== 1 || marker.kinds[0] !== 'note')
    .map((marker) => `${where(marker.paragraph.line, marker.paragraph.text)}: its marker ${marker.id} gives ${marker.kinds.join(', ') || 'no kind'}`);
  assert.deepEqual(problems, []);
});

// Which prefix the PRD's IDs take is not settled (#667). Where config.yaml
// lists the PRD with a prefix, al gives new IDs that prefix, so the IDs in the
// PRD use it.
test('the IDs in the PRD use the prefix config.yaml gives the PRD, where it gives one', async () => {
  const config = await readYamlMap(CONFIG);
  const entry = (Array.isArray(config.docs) ? config.docs : [])
    .find((doc) => doc !== null && typeof doc === 'object' && typeof doc.file === 'string' && path.posix.normalize(doc.file) === PRD);
  if (entry === undefined) return;
  const { markers } = await prd();
  const others = markers.filter((marker) => !marker.id.startsWith(`${entry.prefix}-`)).map((marker) => where(marker.line, marker.id));
  assert.deepEqual(others, [], `${CONFIG} gives ${PRD} the prefix ${entry.prefix}`);
});

// al reads the kinds from schema.yaml when it lists them. So a kind the PRD
// uses is one schema.yaml lists, where schema.yaml lists kinds.
test('each kind the PRD uses is one that schema.yaml lists, where it lists kinds', async () => {
  const schema = await readYamlMap(SCHEMA);
  if (schema.kinds === undefined || schema.kinds === null) return;
  const listed = new Set(Object.values(schema.kinds).flat());
  const { markers } = await prd();
  const missing = markers.flatMap((marker) => marker.kinds.filter((kind) => !listed.has(kind)).map((kind) => `${where(marker.line, marker.id)}: ${kind}`));
  assert.deepEqual(missing, [], `the kinds ${SCHEMA} lists are ${[...listed].join(', ')}`);
});

/** Trees that hold copies of other people's files, dated records, or records al writes. */
const NOT_CITING = new Set(['node_modules', '.git', '.stryker-tmp', 'reports', 'archive', '.assuredloop']);

// The PRD's headings carry a tag, such as `### [PRD-8] 6.1 Shape`, and the
// docs, the code and the tests cite a section by it. So each `[PRD-n]` they
// cite is still a heading's tag. The archived requests are dated records and
// are not read.
test('each [PRD-n] that a file of the repo cites is the tag of a heading in the PRD', async () => {
  const { paragraphs } = await prd();
  const tags = new Set(paragraphs.filter((paragraph) => paragraph.heading).flatMap((paragraph) => [...paragraph.text.matchAll(/\[(PRD-\d+)\]/g)].map((match) => match[1])));
  assert.ok(tags.has('PRD-8'), `the heading of section 6.1 in ${PRD} should still carry [PRD-8], got: ${[...tags].join(', ')}`);

  const tree = await snapshot(repoRoot, (rel) => NOT_CITING.has(path.basename(rel)));
  const problems = [];
  for (const rel of Object.keys(tree).filter((name) => tree[name].startsWith('file:') && /\.(md|js|mjs|cjs|ya?ml|json)$/.test(name))) {
    if (rel === PRD || rel === THIS_FILE) continue;
    const text = await readText(rel);
    for (const match of text.matchAll(/\[(PRD-\d+)\]/g)) {
      if (!tags.has(match[1])) problems.push(`${rel}:${text.slice(0, match.index).split('\n').length}: cites [${match[1]}]`);
    }
  }
  assert.deepEqual(problems, [], `no heading in ${PRD} carries these tags`);
});
