// Decision records (#262): every record in docs/adr/ is in the format of
// obk-arch's "Keep a record of a decision". A changed decision is a new record
// that replaces the old one whole; the old one keeps its text and only its
// status says what replaced it. And everything in the repo that cites a record
// cites the one that holds the decision now, never an amendment of one.
//
// What is old on purpose is left alone: the whole text of a superseded record,
// and the `Supersedes:` line and the `## History` section of a current one.

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { repoRoot, snapshot } from './helpers/cli.js';

/** Trees that hold copies of other people's files, or of our own. */
const IGNORED = new Set(['node_modules', '.git', '.stryker-tmp', 'reports']);

const adrDir = path.join(repoRoot, 'docs', 'adr');

/** This file, whose examples below are citations only as fixtures. */
const THIS_FILE = path.relative(repoRoot, fileURLToPath(import.meta.url)).split(path.sep).join('/');

/** The records there were before #262, each of which is now replaced by a new one. */
const OLD_RECORDS = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010'];

/** The five sections every current record answers. */
const SECTIONS = ['Context', 'Decision', 'Alternatives considered', 'Consequences', 'History'];

/** `[ADR NNNN](NNNN-slug.md)`, the link a record uses for another record. */
const RECORD_LINK = /\[ADR (\d{4})\]\(((\d{4})-[^)\s]+\.md)\)/g;

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** Every file under the repo, as paths relative to it. */
async function repoFiles() {
  const tree = await snapshot(repoRoot, (rel) => IGNORED.has(path.basename(rel)));
  return Object.keys(tree).filter((rel) => tree[rel].startsWith('file:'));
}

/** The lines of a record, split into the header (before the first `## `) and its sections. */
function parseRecord(text) {
  const lines = text.split('\n');
  const firstSection = lines.findIndex((line) => /^## /.test(line));
  const headerEnd = firstSection === -1 ? lines.length : firstSection;
  const header = lines.slice(0, headerEnd).join('\n');
  const sections = [];
  lines.forEach((line, at) => {
    const heading = /^## (.*?)\s*$/.exec(line);
    if (heading !== null) sections.push({ name: heading[1], from: at + 1, to: lines.length });
  });
  sections.forEach((section, at) => {
    if (at + 1 < sections.length) section.to = sections[at + 1].from - 1;
    section.body = lines.slice(section.from, section.to).join('\n');
  });
  return { lines, header, sections };
}

/**
 * Every record in docs/adr/, keyed by its number: the file name, the text, what
 * its status says replaced it, and what its `Supersedes:` line says it replaces.
 */
async function records() {
  const names = (await readdir(adrDir)).filter((name) => /^\d{4}-.+\.md$/.test(name)).sort();
  const all = [];
  for (const name of names) {
    const text = await readFile(path.join(adrDir, name), 'utf8');
    const { lines, header, sections } = parseRecord(text);
    const status = /\bStatus:\s*([^\n]*)/.exec(header)?.[1] ?? null;
    const by = status === null ? null : /^superseded by \[ADR (\d{4})\]\(((\d{4})-[^)\s]+\.md)\)/.exec(status);
    const supersedesLine = lines.findIndex((line) => /^Supersedes:/.test(line));
    const supersedes = supersedesLine === -1
      ? []
      : [...lines[supersedesLine].matchAll(RECORD_LINK)].map((match) => ({ number: match[1], file: match[2], fileNumber: match[3] }));
    all.push({
      name,
      rel: `docs/adr/${name}`,
      number: name.slice(0, 4),
      text,
      lines,
      header,
      sections,
      status,
      supersededBy: by === null ? null : { number: by[1], file: by[2], fileNumber: by[3] },
      supersedesLine: supersedesLine === -1 ? null : supersedesLine + 1,
      supersedes,
    });
  }
  return all;
}

const byNumber = (all) => new Map(all.map((record) => [record.number, record]));
const isCurrent = (record) => record.supersededBy === null && !/^superseded\b/i.test(record.status ?? '');
const sectionOf = (record, name) => record.sections.find((section) => section.name === name);

/** The 1-based lines of a record that cite older records on purpose. */
function exemptLines(record) {
  if (!isCurrent(record)) return () => true;
  const history = sectionOf(record, 'History');
  return (line) => line === record.supersedesLine
    || (history !== undefined && line >= history.from && line <= history.to);
}

/**
 * Every citation of a record in a text: `ADR 0004`, `ADRs 0005 and 0008`,
 * `ADRs 0001, 0002 and 0003`, `→ ADR 0007`, and a link or a path to
 * docs/adr/NNNN-slug.md. `from` is the file the text is in, relative to the
 * repo, so a relative link can be followed. Each citation carries its line,
 * the number it names, the file it names when it names one, and where in the
 * text it is.
 */
function citationsIn(text, from) {
  const found = [];
  for (const match of text.matchAll(/\bADRs?[ \t-]+(\d{4}(?:(?:\s*,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+)\d{4})*)/g)) {
    for (const number of match[1].match(/\d{4}/g)) {
      found.push({ line: lineAt(text, match.index), number, file: null, index: match.index, length: match[0].length });
    }
  }
  const seen = [];
  const add = (index, length, target) => {
    seen.push(index);
    found.push({ line: lineAt(text, index), number: target.slice(0, 4), file: target, index, length });
  };
  const dir = path.posix.dirname(from);
  for (const match of text.matchAll(/\]\(([^)\s#]+\.md)(?:#[^)\s]*)?\)/g)) {
    const resolved = path.posix.normalize(path.posix.join(dir, match[1]));
    if (path.posix.dirname(resolved) === 'docs/adr' && /^\d{4}-/.test(path.posix.basename(resolved))) {
      add(match.index + 2, match[1].length, path.posix.basename(resolved));
    }
  }
  for (const match of text.matchAll(/\bdocs\/adr\/(\d{4}-[\w.-]*?\.md)/g)) {
    const at = match.index;
    // The same path inside a markdown link was taken above.
    if (seen.some((index) => Math.abs(index - at) < 6)) continue;
    add(at, match[0].length, match[1]);
  }
  return found;
}

/** Whether a citation is next to the word amendment or amended. */
const AMEND = /\bamend(?:ment|ed)\b/i;
const NEAR = 30;
const nextToAmendment = (text, citation) => AMEND.test(text.slice(
  Math.max(0, citation.index - NEAR),
  citation.index + citation.length + NEAR,
));

/** Every citation in the repo that is meant to cite the record in force, with its file. */
async function liveCitations() {
  const all = await records();
  const exempt = new Map(all.map((record) => [record.rel, exemptLines(record)]));
  const out = [];
  for (const rel of await repoFiles()) {
    if (rel === THIS_FILE) continue;
    const text = await readFile(path.join(repoRoot, rel), 'utf8');
    const isExempt = exempt.get(rel) ?? (() => false);
    for (const citation of citationsIn(text, rel)) {
      if (!isExempt(citation.line)) out.push({ rel, text, ...citation });
    }
  }
  return { all, citations: out };
}

test('the citation check sees every way the repo cites a record, and not other numbers', () => {
  const numbers = (text, from = 'README.md') => citationsIn(text, from).map((citation) => citation.number);

  assert.deepEqual(numbers('the book is kept fresh by a hook (ADR 0010)'), ['0010']);
  assert.deepEqual(numbers('[decided] → ADR 0007'), ['0007']);
  assert.deepEqual(numbers('ADRs 0005 and 0008'), ['0005', '0008']);
  assert.deepEqual(numbers('ADRs 0001, 0002 and 0003'), ['0001', '0002', '0003']);
  assert.deepEqual(numbers('(PRD 6.7, ADR 0004, ADR 0009)'), ['0004', '0009']);
  assert.deepEqual(
    numbers('([ADR 0004](docs/adr/0004-skills-are-linked-never-copied.md))').sort(),
    ['0004', '0004'],
    'a link is two citations: the text and the file it points at',
  );
  assert.deepEqual(
    citationsIn('([ADR 0004](docs/adr/0004-skills-are-linked-never-copied.md))', 'README.md').map((citation) => citation.file),
    [null, '0004-skills-are-linked-never-copied.md'],
  );
  assert.deepEqual(numbers('see [the hooks](../adr/0010-kit-hooks-live-in-the-bot-folder.md)', 'docs/proposals/x.md'), ['0010']);
  assert.deepEqual(numbers('[ADR 0011](0011-orca-is-the-host.md)', 'docs/adr/0012-x.md'), ['0011', '0011']);
  assert.deepEqual(numbers('// read docs/adr/0002-the-book-is-the-authority-for-session-ids.md'), ['0002']);
  assert.deepEqual(citationsIn('one\ntwo ADR 0003\n', 'README.md').map((citation) => citation.line), [2]);

  assert.deepEqual(numbers('# ADR NNNN: <the decision>'), [], 'the placeholder in the format');
  assert.deepEqual(numbers('The PRD and the ADRs carry the rest'), []);
  assert.deepEqual(numbers('PRD 6.9, tech notes 4, #232, 2026-09-24'), []);
  assert.deepEqual(numbers('[the PRD](docs/prd.md)'), []);
});

test('the amendment check sees a citation of an amendment, and not an amendment of something else', () => {
  const flagged = (text) => citationsIn(text, 'README.md').filter((citation) => nextToAmendment(text, citation)).length;

  assert.equal(flagged('types nothing (ADR 0001, amendment).'), 1);
  assert.equal(flagged(' * (ADR 0008\'s\n * amendment). Orca offers no `run-delete`'), 1);
  assert.equal(flagged('with the sandbox switch in the amendment to ADR 0005.'), 1);
  assert.equal(flagged('ADR 0005, as amended on 2026-09-21'), 1);

  assert.equal(flagged('the sandbox switch in ADR 0011.'), 0);
  assert.equal(flagged('makes sure some tab exists outside the book (amendment 4)'), 0);
});

test('every record is named NNNN-slug.md, is titled with its own number, and no number is used twice', async () => {
  const all = await records();
  assert.ok(all.length >= OLD_RECORDS.length, `docs/adr/ should hold at least the ${OLD_RECORDS.length} records there were, got ${all.length}`);

  const problems = [];
  for (const record of all) {
    const title = /^# ADR (\d{4}): \S/.exec(record.lines[0]);
    if (title === null) problems.push(`${record.rel}:1: should start \`# ADR ${record.number}: <title>\`, got: ${record.lines[0]}`);
    else if (title[1] !== record.number) problems.push(`${record.rel}:1: the title says ADR ${title[1]}, the file name ${record.number}`);
  }
  const numbers = all.map((record) => record.number);
  const twice = numbers.filter((number, at) => numbers.indexOf(number) !== at);
  for (const number of new Set(twice)) {
    problems.push(`ADR ${number} is used by more than one file: ${all.filter((record) => record.number === number).map((record) => record.name).join(', ')}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('each record there was before #262 is superseded by a link to a newer record that exists', async () => {
  const all = await records();
  const known = byNumber(all);
  const problems = [];
  for (const number of OLD_RECORDS) {
    const record = known.get(number);
    if (record === undefined) {
      problems.push(`ADR ${number} is gone from docs/adr/; a superseded record keeps its file`);
      continue;
    }
    const { supersededBy: by } = record;
    if (by === null) {
      problems.push(`${record.rel}: the status should be \`superseded by [ADR MMMM](MMMM-slug.md).\`, got: ${record.status}`);
      continue;
    }
    const target = known.get(by.number);
    if (by.fileNumber !== by.number) problems.push(`${record.rel}: the status names ADR ${by.number} but links ${by.file}`);
    else if (target === undefined || target.name !== by.file) problems.push(`${record.rel}: the status links ${by.file}, which is not in docs/adr/`);
    else if (Number(by.number) <= Number(number)) problems.push(`${record.rel}: is superseded by ADR ${by.number}, which is not a newer record`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('a superseded record and the record that replaced it name each other', async () => {
  const all = await records();
  const known = byNumber(all);
  const problems = [];
  for (const record of all) {
    const by = record.supersededBy;
    if (by !== null) {
      const target = known.get(by.number);
      if (target !== undefined && !target.supersedes.some((entry) => entry.number === record.number)) {
        problems.push(`${record.rel}: is superseded by ADR ${by.number}, whose \`Supersedes:\` line does not name it`);
      }
    }
    for (const entry of record.supersedes) {
      const older = known.get(entry.number);
      if (entry.fileNumber !== entry.number) problems.push(`${record.rel}:${record.supersedesLine}: names ADR ${entry.number} but links ${entry.file}`);
      else if (older === undefined || older.name !== entry.file) problems.push(`${record.rel}:${record.supersedesLine}: links ${entry.file}, which is not in docs/adr/`);
      else if (older.supersededBy?.number !== record.number) {
        problems.push(`${record.rel}:${record.supersedesLine}: supersedes ADR ${entry.number}, whose status does not say superseded by ADR ${record.number}, got: ${older.status}`);
      }
    }
    if (record.supersedesLine !== null && record.supersedes.length === 0) {
      problems.push(`${record.rel}:${record.supersedesLine}: the \`Supersedes:\` line links no record as [ADR KKKK](KKKK-slug.md)`);
    }
  }
  const current = all.filter(isCurrent);
  assert.ok(current.length > 0, 'there should be at least one record in force');
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every record in force has the header lines and the sections of the obk-arch format', async () => {
  const current = (await records()).filter(isCurrent);
  assert.ok(current.length > 0, 'there should be at least one record in force');

  const problems = [];
  for (const record of current) {
    if (!/(?:^|\s)Date: \d{4}-\d{2}-\d{2}\b/m.test(record.header)) problems.push(`${record.rel}: no \`Date: YYYY-MM-DD.\` line`);
    if (!/(?:^|\s)Status: (?:proposed|accepted|rejected|deprecated)\b/m.test(record.header)) {
      problems.push(`${record.rel}: the status should be proposed, accepted, rejected or deprecated, got: ${record.status}`);
    }
    if (!/(?:^|\s)Decided by: \S/m.test(record.header)) problems.push(`${record.rel}: no \`Decided by:\` line`);
    for (const name of SECTIONS) {
      const section = sectionOf(record, name);
      if (section === undefined) problems.push(`${record.rel}: no \`## ${name}\` section`);
      else if (section.body.trim() === '') problems.push(`${record.rel}:${section.from}: the \`## ${name}\` section is empty`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('no record in force has an amendment, or a line marked as changed in place', async () => {
  const current = (await records()).filter(isCurrent);
  assert.ok(current.length > 0, 'there should be at least one record in force');

  const problems = [];
  for (const record of current) {
    const exempt = exemptLines(record);
    record.lines.forEach((line, at) => {
      if (/^#{1,6}\s+Amendment/i.test(line)) problems.push(`${record.rel}:${at + 1}: an amendment section: ${line}`);
      else if (!exempt(at + 1) && AMEND.test(line)) problems.push(`${record.rel}:${at + 1}: marks a change in place: ${line.trim()}`);
    });
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('a record that supersedes others has a History line for each, down the chain', async () => {
  const all = await records();
  const known = byNumber(all);
  const problems = [];
  for (const record of all.filter(isCurrent)) {
    const history = sectionOf(record, 'History');
    const cited = new Set(history === undefined ? [] : citationsIn(history.body, record.rel).map((citation) => citation.number));
    const chain = new Set();
    const walk = (entry) => {
      if (chain.has(entry.number)) return;
      chain.add(entry.number);
      for (const older of known.get(entry.number)?.supersedes ?? []) walk(older);
    };
    record.supersedes.forEach(walk);
    for (const number of chain) {
      if (!cited.has(number)) problems.push(`${record.rel}: replaces ADR ${number}, directly or down the chain, and its History has no line for it`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every ADR cited in the repo exists and is the record in force', async () => {
  const { all, citations } = await liveCitations();
  const known = byNumber(all);
  assert.ok(citations.length > 0, 'no citation of a record was found anywhere, so the check sees nothing');

  const problems = [];
  for (const citation of citations) {
    const where = `${citation.rel}:${citation.line}`;
    const record = known.get(citation.number);
    if (record === undefined) problems.push(`${where}: cites ADR ${citation.number}, which does not exist`);
    else if (citation.file !== null && citation.file !== record.name) problems.push(`${where}: links ${citation.file}, which is not in docs/adr/ (ADR ${citation.number} is ${record.name})`);
    else if (!isCurrent(record)) {
      problems.push(`${where}: ${citation.file === null ? 'cites' : `links ${citation.file}, that is`} ADR ${citation.number}, which is superseded${record.supersededBy === null ? '' : ` by ADR ${record.supersededBy.number}`}`);
    }
  }
  assert.deepEqual(problems, [], `${problems.length} citations do not point at the record in force:\n${problems.join('\n')}`);
});

test('nothing in the repo cites an amendment of an ADR', async () => {
  const { citations } = await liveCitations();
  assert.ok(citations.length > 0, 'no citation of a record was found anywhere, so the check sees nothing');

  const problems = citations
    .filter((citation) => nextToAmendment(citation.text, citation))
    .map((citation) => `${citation.rel}:${citation.line}: cites an amendment of ADR ${citation.number}: ${citation.text.split('\n')[citation.line - 1].trim()}`);
  assert.deepEqual([...new Set(problems)], [], [...new Set(problems)].join('\n'));
});
