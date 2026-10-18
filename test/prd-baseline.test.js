// The PRD as AssuredLoop's baseline (#474). AssuredLoop reads the spec from a
// folder of its own, named by `root:` in `.assuredloop` at the repo root, so
// the PRD moves from docs/prd.md to docs/prd/prd.md and that folder holds it
// and none of the rest of the docs: the decision records stay in docs/adr/.
//
// What can break in a move like this is the links. Every place that named the
// old path follows the move; the PRD's own relative links still resolve from
// its new folder; and a link to a heading inside the PRD still lands on a
// heading there, the one it names, whatever IDs the tool has added to the
// headings by then (an ID is part of the heading, so it changes the anchor).
//
// The PRD's text is otherwise unchanged by the move. That is a property of the
// change, not of the repo, and is left to the review of the diff: a test of it
// would forbid every later edit of the PRD.

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { repoRoot, snapshot } from './helpers/cli.js';

/** Trees that hold copies of other people's files, or of our own. */
const IGNORED = new Set(['node_modules', '.git', '.stryker-tmp', 'reports']);

const OLD_PRD = 'docs/prd.md';
const NEW_PRD = 'docs/prd/prd.md';
const BASELINE_ROOT = 'docs/prd';

/** This file, which names the old path on purpose. */
const THIS_FILE = path.relative(repoRoot, fileURLToPath(import.meta.url)).split(path.sep).join('/');

const exists = (rel) => access(path.join(repoRoot, rel)).then(() => true, () => false);
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** The PRD's text, from its new place. */
async function readPrd() {
  assert.ok(await exists(NEW_PRD), `${NEW_PRD} should hold the PRD`);
  return readFile(path.join(repoRoot, NEW_PRD), 'utf8');
}

/** Every file under the repo, as paths relative to it. */
async function repoFiles() {
  const tree = await snapshot(repoRoot, (rel) => IGNORED.has(path.basename(rel)));
  return Object.keys(tree).filter((rel) => tree[rel].startsWith('file:'));
}

/** Every file under a folder of the repo, as paths relative to the repo. */
async function filesUnder(rel) {
  const tree = await snapshot(path.join(repoRoot, rel), (child) => IGNORED.has(path.basename(child)));
  return Object.keys(tree).filter((child) => tree[child].startsWith('file:')).map((child) => path.posix.join(rel, child));
}

/**
 * The anchor GitHub gives a heading: lower case, everything but letters,
 * digits, `_`, `-` and spaces dropped, each space a hyphen.
 */
const slug = (heading) => heading.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');

/** The headings of a markdown text outside code fences, each with its anchor. */
function headingsOf(text) {
  const headings = [];
  const used = new Map();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading === null) continue;
    const base = slug(heading[1]);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    headings.push({ text: heading[1], anchor: count === 0 ? base : `${base}-${count}` });
  }
  return headings;
}

/**
 * Every relative markdown link in a text, inline or by reference, with its
 * text, the repo path it resolves to from the file `from`, and its anchor.
 */
function linksIn(text, from) {
  const links = [];
  const add = (index, label, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return;
    const hash = target.indexOf('#');
    const file = (hash === -1 ? target : target.slice(0, hash)).split('?')[0];
    const anchor = hash === -1 ? null : decodeURIComponent(target.slice(hash + 1));
    const resolved = file === ''
      ? from
      : path.posix.normalize(file.startsWith('/') ? file.slice(1) : path.posix.join(path.posix.dirname(from), file)).replace(/\/$/, '');
    links.push({ line: lineAt(text, index), label, target, resolved, anchor });
  };
  for (const match of text.matchAll(/\[((?:[^\][]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    add(match.index, match[1], match[2]);
  }
  for (const match of text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s|$)/gm)) {
    add(match.index, match[1], match[2]);
  }
  return links;
}

/** Every relative link in every markdown file of the repo. */
async function markdownLinks() {
  const links = [];
  for (const rel of (await repoFiles()).filter((file) => file.endsWith('.md'))) {
    const text = await readFile(path.join(repoRoot, rel), 'utf8');
    for (const link of linksIn(text, rel)) links.push({ ...link, file: rel });
  }
  return links;
}

/** `.assuredloop` as its `key: value` lines. */
async function assuredloopLines() {
  const text = await readFile(path.join(repoRoot, '.assuredloop'), 'utf8').catch(() => '');
  return text.split('\n')
    .map((line) => /^\s*([^:\s]+)\s*:\s*(.*?)\s*$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ key: match[1], value: match[2] }));
}

test('the anchor rule gives the anchors GitHub gives', () => {
  // The one CONTRIBUTING.md links to today (the README until #652).
  assert.equal(slug('7.3 Decided rules inside the skills'), '73-decided-rules-inside-the-skills');
  assert.equal(slug('6.6 Rules and `AGENTS.md`'), '66-rules-and-agentsmd');
  // With an ID in front, as AssuredLoop writes them.
  assert.equal(slug('[PRD-12] 6.1 Something'), 'prd-12-61-something');
  assert.deepEqual(
    headingsOf('# A\n\n## B c\n\n```\n# not a heading\n```\n\n## B c\n').map((heading) => heading.anchor),
    ['a', 'b-c', 'b-c-1'],
  );
  assert.deepEqual(
    linksIn('see [`docs/adr/`](adr/), [PRD 7.3](../prd/prd.md#73-x), [top](#a) and [web](https://example.com/x.md)', 'docs/prd/prd.md')
      .map((link) => [link.label, link.resolved, link.anchor]),
    [['`docs/adr/`', 'docs/prd/adr', null], ['PRD 7.3', 'docs/prd/prd.md', '73-x'], ['top', 'docs/prd/prd.md', 'a']],
  );
});

test('the PRD is at docs/prd/prd.md, and docs/prd.md is gone', async () => {
  assert.ok(await exists(NEW_PRD), `${NEW_PRD} should hold the PRD`);
  assert.ok(!(await exists(OLD_PRD)), `${OLD_PRD} should no longer exist`);
});

test('no file in the repo names docs/prd.md', async () => {
  const problems = new Set();
  for (const rel of await repoFiles()) {
    if (rel === THIS_FILE) continue;
    const text = await readFile(path.join(repoRoot, rel), 'utf8');
    for (const match of text.matchAll(/docs\/prd\.md/g)) {
      problems.add(`${rel}:${lineAt(text, match.index)}: ${text.split('\n')[lineAt(text, match.index) - 1].trim()}`);
    }
  }
  assert.deepEqual([...problems], [], `these still name the PRD's old path; it is ${NEW_PRD} now`);
});

test('no markdown link in the repo leads to docs/prd.md', async () => {
  const problems = (await markdownLinks())
    .filter((link) => link.resolved === OLD_PRD)
    .map((link) => `${link.file}:${link.line}: [${link.label}](${link.target})`);
  assert.deepEqual(problems, [], `these links lead to the PRD's old place; it is ${NEW_PRD} now`);
});

test('README.md and AGENTS.md point at the PRD in its new place', async () => {
  const readmeLinks = linksIn(await readFile(path.join(repoRoot, 'README.md'), 'utf8'), 'README.md');
  assert.ok(
    readmeLinks.some((link) => link.resolved === NEW_PRD),
    `README.md should link to ${NEW_PRD}`,
  );
  const agents = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(`${BASELINE_ROOT}/`), `AGENTS.md should name where the PRD is now, ${NEW_PRD}`);
});

test('every link to a heading in the PRD lands on one, and on the section it names', async () => {
  const prd = await readPrd();
  const headings = headingsOf(prd);
  const links = (await markdownLinks()).filter((link) => link.resolved === NEW_PRD && link.anchor !== null);
  assert.ok(
    links.some((link) => link.file !== NEW_PRD),
    `some file outside the PRD should link to a heading in it, as CONTRIBUTING.md's PRD 7.3 link does`,
  );

  const problems = [];
  for (const link of links) {
    const heading = headings.find((candidate) => candidate.anchor === link.anchor);
    const where = `${link.file}:${link.line}: [${link.label}](${link.target})`;
    if (heading === undefined) {
      problems.push(`${where}: no heading in ${NEW_PRD} has the anchor #${link.anchor}`);
      continue;
    }
    // A link that says which section it is (`PRD 7.3`) lands on that section.
    const section = /\bPRD (\d+(?:\.\d+)*)\b/.exec(link.label)?.[1];
    if (section === undefined) continue;
    const numbered = heading.text.split(/[\s\]]+/).some((word) => word === section || word === `${section}.`);
    if (!numbered) problems.push(`${where}: lands on "${heading.text}", not on section ${section}`);
  }
  assert.deepEqual(problems, []);
});

test('every relative link in the PRD resolves from its new folder', async () => {
  const prd = await readPrd();
  const links = linksIn(prd, NEW_PRD);
  assert.ok(
    links.some((link) => link.resolved === 'docs/adr'),
    `the PRD's link to the decision records should still reach docs/adr/, got: ${links.map((link) => `${link.target} -> ${link.resolved}`).join(', ')}`,
  );

  const problems = [];
  for (const link of links) {
    const where = `${NEW_PRD}:${link.line}: [${link.label}](${link.target})`;
    if (!(await exists(link.resolved))) {
      problems.push(`${where}: ${link.resolved} does not exist`);
      continue;
    }
    if (link.anchor === null || !link.resolved.endsWith('.md')) continue;
    const target = await readFile(path.join(repoRoot, link.resolved), 'utf8');
    if (!headingsOf(target).some((heading) => heading.anchor === link.anchor)) {
      problems.push(`${where}: no heading in ${link.resolved} has the anchor #${link.anchor}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('.assuredloop at the repo root says root: docs/prd, once', async () => {
  assert.ok(await exists('.assuredloop'), '.assuredloop should be at the repo root');
  const roots = (await assuredloopLines()).filter((line) => line.key === 'root');
  assert.deepEqual(
    roots.map((line) => line.value.replace(/\/+$/, '')),
    [BASELINE_ROOT],
    '.assuredloop should have exactly one root line, root: docs/prd',
  );
});

test('the folder .assuredloop names holds the PRD and none of the other docs', async () => {
  const named = (await assuredloopLines()).find((line) => line.key === 'root')?.value;
  assert.ok(named !== undefined, '.assuredloop should name a root');
  const root = path.posix.normalize(named).replace(/\/+$/, '');
  assert.ok(await exists(root), `the root ${root} should exist`);
  const inside = (rel) => root === '.' || rel === root || rel.startsWith(`${root}/`);
  const files = await filesUnder(root);
  assert.ok(files.includes(NEW_PRD), `${root} should hold ${NEW_PRD}, got: ${files.join(', ')}`);

  // The rest of the docs stays where it was, outside the root.
  for (const rel of ['docs/adr', 'docs/tech-notes.md', 'docs/proposals']) {
    assert.ok(await exists(rel), `${rel} should still be there`);
    assert.ok(!inside(rel), `${rel} should not be inside the root ${root}`);
  }
  const strays = [];
  for (const rel of files) {
    const name = path.posix.basename(rel);
    const first = (await readFile(path.join(repoRoot, rel), 'utf8')).split('\n')[0];
    if (/^\d{4}-.+\.md$/.test(name) || /^# ADR \d{4}\b/.test(first)) strays.push(`${rel}: a decision record`);
    else if (name === 'tech-notes.md') strays.push(`${rel}: the tech notes`);
    else if (rel.split('/').includes('proposals')) strays.push(`${rel}: a proposal`);
  }
  assert.deepEqual(strays, [], `the root ${root} should hold the PRD and none of the other docs`);
});
