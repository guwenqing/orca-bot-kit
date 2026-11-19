// Decision records (#262): every record is in the format of obk-arch's "Keep a
// record of a decision". A changed decision is a new record that replaces the
// old one whole; the old one keeps its text and only its status says what
// replaced it. And everything in the repo that cites a record cites the one
// that holds the decision now, never an amendment of one.
//
// The records come under AssuredLoop's al 5.0.4 (#817). al reads ADRs only in
// `<spec root>/adr/`, and the spec root is docs/prd, so the records moved from
// docs/adr/ to docs/prd/adr/ under the same names, and every link to them
// follows. Each record starts with al's status line, then al's heading marker,
// then the obk-arch header as it was. So a record has two status lines, and
// they agree:
//
//   Status: superseded by ADR-21
//
//   <!-- ADR-11 choice supersedes:ADR-1 -->
//
//   # ADR 0011: Orca is the host
//
//   Date: 2026-09-24.
//   Status: superseded by [ADR 0021](0021-orca-is-the-host.md).
//   Decided by: ...
//   Supersedes: [ADR 0001](0001-orca-is-the-host.md).
//
// What is old on purpose is left alone: the whole text of a superseded record,
// and the `Supersedes:` line and the `## History` section of a current one.
// And, by kit-dev's architect for #817 (replacing the ruling for #509), a
// citation in an accepted record of a superseded record is followed at once by
// ` (superseded, now <the record in force>)`, a link for a link and bare for a
// bare citation, after a possessive `'s` when there is one. The record in force
// is the end of the chain of Status successors. The form is not needed, and not
// written, in al's first line and marker, the header `Status:` and
// `Supersedes:` lines, the `## History` section, or for a record that the
// citing record supersedes, directly or down its chain. Nowhere else is the
// form right. That nothing else of an accepted record changed is a property of
// the change, left to the review of the diff.

import assert from 'node:assert/strict';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { repoRoot, snapshot } from './helpers/cli.js';

/** Trees that hold copies of other people's files, or of our own. */
const IGNORED = new Set(['node_modules', '.git', '.stryker-tmp', 'reports']);

/** Where the records are: al 5.0.4 reads ADRs in `<spec root>/adr/`, and the root is docs/prd (#817). */
const ADR_FOLDER = 'docs/prd/adr';
/** Where the records were until #817. */
const OLD_FOLDER = 'docs/adr';
const adrDir = path.join(repoRoot, ...ADR_FOLDER.split('/'));

/** This file, whose examples below are citations only as fixtures. */
const THIS_FILE = path.relative(repoRoot, fileURLToPath(import.meta.url)).split(path.sep).join('/');

/** The test files that name the records' old place on purpose: this one and the baseline's. */
const NAME_THE_OLD_PLACE = new Set([THIS_FILE, 'test/prd-baseline.test.js']);

/** The records there were before #262, each of which is now replaced by a new one. */
const OLD_RECORDS = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010'];

/** The records in docs/adr/ before #817 moved them, by file name. Number 0043 was never used. */
const RECORDS_BEFORE_THE_MOVE = [
  '0001-orca-is-the-host.md',
  '0002-the-book-is-the-authority-for-session-ids.md',
  '0003-agents-md-is-compiled-from-rule-units.md',
  '0004-skills-are-linked-never-copied.md',
  '0005-three-approval-levels-auto-by-default.md',
  '0006-no-kit-owned-expert-systems.md',
  '0007-test-author-and-reviewer-are-always-separate.md',
  '0008-messaging-transport.md',
  '0009-skills-by-technique-with-a-prefix.md',
  '0010-kit-hooks-live-in-the-bot-folder.md',
  '0011-orca-is-the-host.md',
  '0012-the-book-is-the-authority-for-session-ids.md',
  '0013-agents-md-is-compiled-from-rule-units.md',
  '0014-skills-are-linked-never-copied.md',
  '0015-three-approval-levels-auto-by-default.md',
  '0016-no-kit-owned-expert-systems.md',
  '0017-test-author-and-reviewer-are-always-separate.md',
  '0018-messaging-transport.md',
  '0019-skills-by-technique-with-a-prefix.md',
  '0020-kit-hooks-live-in-the-bot-folder.md',
  '0021-orca-is-the-host.md',
  '0022-kit-hooks-live-in-the-bot-folder.md',
  '0023-orca-is-the-host.md',
  '0024-orca-is-the-host.md',
  '0025-orca-is-the-host.md',
  '0026-the-kit-writes-a-bots-permission-rules-after-the-users-yes.md',
  '0027-a-charters-grants-become-exact-permission-rules.md',
  '0028-a-codex-bots-rules-are-written-in-codexs-own-form.md',
  '0029-a-rule-is-taken-back-through-the-kit-after-the-users-yes.md',
  '0030-messaging-transport.md',
  '0031-orca-is-the-host.md',
  '0032-a-native-message-outside-the-fleet-is-warned-about.md',
  '0033-a-temporary-session-makes-one-of-its-own.md',
  '0034-orca-is-the-host.md',
  '0035-messaging-transport.md',
  '0036-the-kit-writes-every-bots-default-permission-rules.md',
  '0037-permission-changes-and-risky-operations-have-commands-of-their-own.md',
  '0038-a-charters-grants-become-exact-permission-rules.md',
  '0039-a-codex-bots-rules-are-written-in-codexs-own-form.md',
  '0040-a-rule-is-taken-back-through-the-kit-after-the-users-yes.md',
  '0041-permission-changes-and-risky-operations-have-commands-of-their-own.md',
  '0042-messaging-transport.md',
  '0044-extra-arguments-that-widen-a-session-are-refused.md',
  '0045-a-codex-sessions-work-dir-stays-in-its-bot-folder.md',
  '0046-orca-is-the-host.md',
  '0047-the-kit-writes-every-bots-default-permission-rules.md',
  '0048-the-kit-writes-every-bots-default-permission-rules.md',
  '0049-extra-arguments-that-widen-a-session-are-refused.md',
  '0050-the-kit-writes-every-bots-default-permission-rules.md',
  '0051-permission-changes-and-risky-operations-have-commands-of-their-own.md',
  '0052-test-tooling-stays-outside-the-kits-core.md',
  '0053-messaging-transport.md',
  '0054-the-kits-launch-line-names-the-physical-memory-folder.md',
  '0055-the-kit-trims-what-a-claude-code-session-is-sent.md',
  '0056-each-claude-bot-gets-a-memory-folder-of-its-own.md',
  '0057-orca-is-the-host.md',
  '0058-remote-control-is-on-for-every-claude-code-session.md',
  '0059-extra-arguments-that-widen-a-session-are-refused.md',
  '0060-each-claude-bot-gets-a-memory-folder-of-its-own-named-in-the-kits-one-settings.md',
  '0061-parts-that-claude-code-adds-by-itself-stay-out-of-the-kits-main-text.md',
];

/** The five sections every current record answers. */
const SECTIONS = ['Context', 'Decision', 'Alternatives considered', 'Consequences', 'History'];

/** `[ADR NNNN](NNNN-slug.md)`, the link a record uses for another record. */
const RECORD_LINK = /\[ADR (\d{4})\]\(((\d{4})-[^)\s]+\.md)\)/g;

/** al's first line of a record (#817): its status, with the numbers of its successors without leading zeros. */
const AL_STATUS = /^Status: (?:accepted|proposed|superseded by ADR-[1-9]\d*(?:, ADR-[1-9]\d*)*)$/;

/** The words that open the form after a citation of a superseded record (#817). */
const FORM_START = /\(superseded, now\b/g;

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** A record's number as al writes it: without leading zeros. */
const alNumber = (number) => String(Number(number));

/**
 * A signed request record: a request's `request.md` or a file in its `origin/`
 * folder, under requests/ or requests/archive/ (#555). Its text is what the
 * owner signed when it was signed, held by its SHA-256, so a citation in it
 * stays as written when a record is replaced later. The citation checks leave
 * it out, and stay strict for every other file.
 */
const isSignedRequestRecord = (rel) => /^requests\/(?:archive\/)?[^/]+\/(?:request\.md$|origin\/)/.test(rel);

const exists = (rel) => access(path.join(repoRoot, rel)).then(() => true, () => false);

/** Whether a path in the repo is a folder, a file, or neither. */
async function kindOf(rel) {
  const found = await stat(path.join(repoRoot, rel)).catch(() => null);
  if (found === null) return 'absent';
  return found.isDirectory() ? 'folder' : 'file';
}

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
  return { lines, headerEnd, header, sections };
}

/**
 * Every record in docs/prd/adr/, in the order of their numbers: the file name,
 * the text, what its header status says replaced it, and what its
 * `Supersedes:` line says it replaces.
 */
async function records() {
  assert.equal(await kindOf(ADR_FOLDER), 'folder', `${ADR_FOLDER}/ should hold the decision records, where al 5.0.4 reads them`);
  const names = (await readdir(adrDir)).filter((name) => /^\d{4}-.+\.md$/.test(name)).sort();
  const all = [];
  for (const name of names) all.push(recordOf(name, await readFile(path.join(adrDir, name), 'utf8')));
  return all;
}

/**
 * One record, read from its file name and its text. The header is the
 * obk-arch one, below the title; al's first line and marker are above it.
 */
function recordOf(name, text) {
  const { lines, headerEnd, header, sections } = parseRecord(text);
  const titleAt = lines.findIndex((line, at) => at < headerEnd && /^# ADR /.test(line));
  const below = lines.slice(titleAt + 1, headerEnd);
  const statusAt = below.findIndex((line) => /\bStatus:/.test(line));
  const status = statusAt === -1 ? null : /\bStatus:\s*(.*)$/.exec(below[statusAt])[1];
  const by = status === null ? null : /^superseded by ((?:\[ADR \d{4}\]\(\d{4}-[^)\s]+\.md\)(?:\s*,\s*(?:and\s+)?|\s+and\s+)?)+)/.exec(status);
  const successors = by === null ? [] : [...by[1].matchAll(RECORD_LINK)].map((match) => ({ number: match[1], file: match[2], fileNumber: match[3] }));
  const supersedesLine = lines.findIndex((line) => /^Supersedes:/.test(line));
  const supersedes = supersedesLine === -1
    ? []
    : [...lines[supersedesLine].matchAll(RECORD_LINK)].map((match) => ({ number: match[1], file: match[2], fileNumber: match[3] }));
  return {
    name,
    rel: `${ADR_FOLDER}/${name}`,
    number: name.slice(0, 4),
    text,
    lines,
    header,
    sections,
    titleLine: titleAt === -1 ? null : titleAt + 1,
    status,
    statusLine: statusAt === -1 ? null : titleAt + 1 + statusAt + 1,
    successors,
    supersededBy: successors[0] ?? null,
    supersedesLine: supersedesLine === -1 ? null : supersedesLine + 1,
    supersedes,
  };
}

const byNumber = (all) => new Map(all.map((record) => [record.number, record]));
const isCurrent = (record) => record.supersededBy === null && !/^superseded\b/i.test(record.status ?? '');
const isAccepted = (record) => isCurrent(record) && /^accepted\b/i.test(record.status ?? '');
const sectionOf = (record, name) => record.sections.find((section) => section.name === name);

/**
 * The 1-based lines of a record that cite older records on purpose: all of a
 * superseded record; al's first line and marker, the header `Status:` and
 * `Supersedes:` lines and the `## History` section of a current one.
 */
function exemptLines(record) {
  if (!isCurrent(record)) return () => true;
  const history = sectionOf(record, 'History');
  return (line) => line === 1 || line === 3
    || line === record.statusLine
    || line === record.supersedesLine
    || (history !== undefined && line >= history.from && line <= history.to);
}

/** The numbers of the records a record supersedes, directly or down the chain. */
function chainOf(record, known) {
  const chain = new Set();
  const walk = (entry) => {
    if (chain.has(entry.number)) return;
    chain.add(entry.number);
    for (const older of known.get(entry.number)?.supersedes ?? []) walk(older);
  };
  record.supersedes.forEach(walk);
  return chain;
}

/**
 * The record in force at the end of a record's chain of Status successors, or
 * undefined when the chain leads to no record there is.
 */
function inForce(record, known) {
  const seen = new Set();
  let at = record;
  while (!isCurrent(at)) {
    if (seen.has(at.number)) return undefined;
    seen.add(at.number);
    const next = at.supersededBy;
    if (next === null) return undefined;
    at = known.get(next.number);
    if (at === undefined || at.name !== next.file) return undefined;
  }
  return at;
}

/**
 * Every citation of a record in a text: `ADR 0004`, `ADRs 0005 and 0008`,
 * `ADRs 0001, 0002 and 0003`, `→ ADR 0007`, and a link or a path to
 * docs/prd/adr/NNNN-slug.md. `from` is the file the text is in, relative to the
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
    if (path.posix.dirname(resolved) === ADR_FOLDER && /^\d{4}-/.test(path.posix.basename(resolved))) {
      add(match.index + 2, match[1].length, path.posix.basename(resolved));
    }
  }
  for (const match of text.matchAll(/\bdocs\/prd\/adr\/(\d{4}-[\w.-]*?\.md)/g)) {
    const at = match.index;
    // The same path inside a markdown link was taken above.
    if (seen.some((index) => Math.abs(index - at) < 6)) continue;
    add(at, match[0].length, match[1]);
  }
  return found;
}

/**
 * Where a record cites another record, for the form of #817: a link to a
 * record in its folder (`[ADR 0036](0036-slug.md)`), or a bare `ADR 0036`, each
 * number of a list on its own. `end` is where the citation ends: after the
 * link's `)`, or after the number.
 */
function citeSitesIn(text) {
  const sites = [];
  const links = [];
  for (const match of text.matchAll(/\[[^\]\n]*\]\(((\d{4})-[^)\s#]*\.md)(?:#[^)\s]*)?\)/g)) {
    links.push([match.index, match.index + match[0].length]);
    sites.push({ index: match.index, end: match.index + match[0].length, number: match[2], link: true });
  }
  for (const match of text.matchAll(/\bADRs?[ \t-]+(\d{4}(?:(?:\s*,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+)\d{4})*)/g)) {
    if (links.some(([from, to]) => match.index >= from && match.index < to)) continue;
    const listAt = match.index + match[0].length - match[1].length;
    for (const number of match[1].matchAll(/\d{4}/g)) {
      sites.push({ index: match.index, end: listAt + number.index + 4, number: number[0], link: false });
    }
  }
  return sites;
}

/**
 * The form a citation of a superseded record needs in `record`, by the rule of
 * #817, and the forms it has where the rule needs none. Each needed one says
 * where it is, what it should be, and whether it is there.
 */
function formsOf(record, known) {
  const { text } = record;
  const needed = [];
  const placed = new Set();
  if (isAccepted(record)) {
    const exempt = exemptLines(record);
    const chain = chainOf(record, known);
    for (const site of citeSitesIn(text)) {
      const line = lineAt(text, site.index);
      if (exempt(line)) continue;
      const cited = known.get(site.number);
      if (cited === undefined || isCurrent(cited) || chain.has(site.number)) continue;
      const end = inForce(cited, known);
      const after = site.end + (/^['’]s(?!\w)/.test(text.slice(site.end)) ? 2 : 0);
      const expected = end === undefined ? null : ` (superseded, now ${site.link ? `[ADR ${end.number}](${end.name})` : `ADR ${end.number}`})`;
      // A possessive goes before the form, not after it.
      const there = expected !== null && text.startsWith(expected, after)
        && !/^['’]s(?!\w)/.test(text.slice(after + expected.length));
      if (there) placed.add(after + 1);
      needed.push({ line, lines: [line, lineAt(text, site.end)], number: site.number, expected, there });
    }
  }
  const strays = [...text.matchAll(FORM_START)].filter((match) => !placed.has(match.index)).map((match) => lineAt(text, match.index));
  return { needed, strays };
}

/** What is wrong with the forms of #817 in the records `all`, one line each. */
function formProblems(all) {
  const known = byNumber(all);
  const problems = [];
  for (const record of all) {
    const { needed, strays } = formsOf(record, known);
    for (const one of needed.filter((form) => !form.there)) {
      const where = `${record.rel}:${one.line}`;
      problems.push(one.expected === null
        ? `${where}: cites ADR ${one.number}, which is superseded, and its chain leads to no record in force`
        : `${where}: cites ADR ${one.number}, which is superseded; it should be followed at once by \`${one.expected.trim()}\``);
    }
    for (const line of strays) problems.push(`${record.rel}:${line}: has a \`(superseded, now …)\` where the rule asks for none`);
  }
  return problems;
}

/** Whether a citation is next to the word amendment or amended. */
const AMEND = /\bamend(?:ment|ed)\b/i;
const NEAR = 30;
const nextToAmendment = (text, citation) => AMEND.test(text.slice(
  Math.max(0, citation.index - NEAR),
  citation.index + citation.length + NEAR,
));

/**
 * Every citation in `files` (`[{ rel, text }]`) that is meant to cite the
 * record in force, with its file, given the records `all`.
 */
function citationsOf(all, files) {
  const exempt = new Map(all.map((record) => [record.rel, exemptLines(record)]));
  const out = [];
  for (const { rel, text } of files) {
    const isExempt = exempt.get(rel) ?? (() => false);
    for (const citation of citationsIn(text, rel)) {
      if (!isExempt(citation.line)) out.push({ rel, text, ...citation });
    }
  }
  return out;
}

/** Every citation in the repo that is meant to cite the record in force, with its file. */
async function liveCitations() {
  const all = await records();
  const files = [];
  for (const rel of await repoFiles()) {
    if (rel === THIS_FILE || isSignedRequestRecord(rel)) continue;
    files.push({ rel, text: await readFile(path.join(repoRoot, rel), 'utf8') });
  }
  return { all, citations: citationsOf(all, files) };
}

/**
 * Whether a citation in `citer`, a record, of the superseded `record` may stay
 * (the architect's rule for #817): `citer` is accepted, and either it
 * supersedes `record` itself, directly or down its chain, or the citation is
 * followed by the form that names the record in force.
 */
function allowedInAccepted(citer, record, citation, known) {
  if (citer === undefined || !isAccepted(citer)) return false;
  if (chainOf(citer, known).has(record.number)) return true;
  return formsOf(citer, known).needed.some((form) => form.there && form.number === record.number && form.lines.includes(citation.line));
}

/**
 * What is wrong with the citations in `files` (`[{ rel, text }]`), given the
 * records `all`: one line each for a record that does not exist, a link to a
 * file that is not the record's, and a citation of a record that is not the
 * one in force.
 */
function citationProblems(all, files) {
  const known = byNumber(all);
  const byFile = new Map(all.map((record) => [record.rel, record]));
  const problems = [];
  for (const citation of citationsOf(all, files)) {
    const where = `${citation.rel}:${citation.line}`;
    const record = known.get(citation.number);
    if (record === undefined) problems.push(`${where}: cites ADR ${citation.number}, which does not exist`);
    else if (citation.file !== null && citation.file !== record.name) problems.push(`${where}: links ${citation.file}, which is not in ${ADR_FOLDER}/ (ADR ${citation.number} is ${record.name})`);
    else if (!isCurrent(record) && !allowedInAccepted(byFile.get(citation.rel), record, citation, known)) {
      problems.push(`${where}: ${citation.file === null ? 'cites' : `links ${citation.file}, that is`} ADR ${citation.number}, which is superseded${record.supersededBy === null ? '' : ` by ADR ${record.supersededBy.number}`}`);
    }
  }
  return problems;
}

/**
 * Every relative markdown link target in a text, with its line, resolved to a
 * repo path from the file `from`.
 */
function linkTargetsIn(text, from) {
  const out = [];
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    const file = target.split('#')[0].split('?')[0];
    const resolved = path.posix.normalize(file.startsWith('/') ? file.slice(1) : path.posix.join(path.posix.dirname(from), file)).replace(/\/$/, '');
    out.push({ line: lineAt(text, match.index), target, resolved });
  }
  return out;
}

test('the citation check sees every way the repo cites a record, and not other numbers', () => {
  const numbers = (text, from = 'README.md') => citationsIn(text, from).map((citation) => citation.number);

  assert.deepEqual(numbers('the book is kept fresh by a hook (ADR 0010)'), ['0010']);
  assert.deepEqual(numbers('[decided] → ADR 0007'), ['0007']);
  assert.deepEqual(numbers('ADRs 0005 and 0008'), ['0005', '0008']);
  assert.deepEqual(numbers('ADRs 0001, 0002 and 0003'), ['0001', '0002', '0003']);
  assert.deepEqual(numbers('(PRD 6.7, ADR 0004, ADR 0009)'), ['0004', '0009']);
  assert.deepEqual(
    numbers('([ADR 0004](docs/prd/adr/0004-skills-are-linked-never-copied.md))').sort(),
    ['0004', '0004'],
    'a link is two citations: the text and the file it points at',
  );
  assert.deepEqual(
    citationsIn('([ADR 0004](docs/prd/adr/0004-skills-are-linked-never-copied.md))', 'README.md').map((citation) => citation.file),
    [null, '0004-skills-are-linked-never-copied.md'],
  );
  assert.deepEqual(numbers('see [the hooks](../prd/adr/0010-kit-hooks-live-in-the-bot-folder.md)', 'docs/proposals/x.md'), ['0010']);
  assert.deepEqual(numbers('see [the hooks](adr/0010-kit-hooks-live-in-the-bot-folder.md)', 'docs/prd/prd.md'), ['0010'], 'from the PRD, beside the folder');
  assert.deepEqual(numbers('[ADR 0011](0011-orca-is-the-host.md)', 'docs/prd/adr/0012-x.md'), ['0011', '0011']);
  assert.deepEqual(numbers('// read docs/prd/adr/0002-the-book-is-the-authority-for-session-ids.md'), ['0002']);
  assert.deepEqual(citationsIn('one\ntwo ADR 0003\n', 'README.md').map((citation) => citation.line), [2]);

  assert.deepEqual(numbers('# ADR NNNN: <the decision>'), [], 'the placeholder in the format');
  assert.deepEqual(numbers('The PRD and the ADRs carry the rest'), []);
  assert.deepEqual(numbers('PRD 6.9, tech notes 4, #232, 2026-09-24'), []);
  assert.deepEqual(numbers('[the PRD](docs/prd/prd.md)'), []);
  assert.deepEqual(numbers('Status: superseded by ADR-21'), [], 'al\'s first line names a record by its number without zeros');
  assert.deepEqual(numbers('<!-- ADR-51 choice supersedes:ADR-41 -->'), [], 'al\'s marker');
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

// The citation rule on fixtures (the architect's rule for #817, which replaces
// the ruling for #509). In an accepted record, a citation of a superseded
// record is followed at once by ` (superseded, now <the record in force>)`.
// Everywhere else, a citation names the record in force.

/**
 * A record in the layout of #817, with `status` as its header Status line and
 * `body` as its Consequences. `supersedes` is a list of `[number, slug]`.
 */
function fixture(number, slug, status, body = 'Nothing here.', {
  supersedes = [], decidedBy = 'the owner.', history = '- 2026-10-09: made.',
} = {}) {
  const word = /^\w+/.exec(status)[0];
  const successors = [...status.matchAll(/\[ADR (\d{4})\]/g)].map((match) => `ADR-${alNumber(match[1])}`);
  const alLine = word === 'superseded' ? `Status: superseded by ${successors.join(', ')}` : `Status: ${word}`;
  const marker = supersedes.length === 0
    ? `<!-- ADR-${alNumber(number)} choice -->`
    : `<!-- ADR-${alNumber(number)} choice supersedes:${supersedes.map(([older]) => `ADR-${alNumber(older)}`).join(',')} -->`;
  return recordOf(`${number}-${slug}.md`, [
    alLine,
    '',
    marker,
    '',
    `# ADR ${number}: ${slug}`,
    '',
    'Date: 2026-10-09.',
    `Status: ${status}`,
    `Decided by: ${decidedBy}`,
    ...(supersedes.length === 0 ? [] : [`Supersedes: ${supersedes.map(([older, olderSlug]) => `[ADR ${older}](${older}-${olderSlug}.md)`).join(', ')}.`]),
    '',
    '## Context', '', 'Context.', '',
    '## Decision', '', 'Decision.', '',
    '## Alternatives considered', '', 'None.', '',
    '## Consequences', '', body, '',
    '## History', '', history, '',
  ].join('\n'));
}

/** The problems the citation checks find in these records, and in these other files, `[{ rel, text }]`. */
const problemsIn = (all, others = []) => [
  ...citationProblems(all, [...all.map((record) => ({ rel: record.rel, text: record.text })), ...others]),
  ...formProblems(all),
];

/**
 * A chain: ADR 0001 is superseded by ADR 0002, ADR 0002 by ADR 0003, and ADR
 * 0003 is accepted, so ADR 0003 is in force for both. ADR 0004 is accepted and
 * supersedes nothing.
 */
const CHAIN = () => [
  fixture('0001', 'old-way', 'superseded by [ADR 0002](0002-mid-way.md).'),
  fixture('0002', 'mid-way', 'superseded by [ADR 0003](0003-new-way.md).', 'Nothing here.', { supersedes: [['0001', 'old-way']] }),
  fixture('0003', 'new-way', 'accepted.', 'Nothing here.', { supersedes: [['0002', 'mid-way']] }),
  fixture('0004', 'other-way', 'accepted.'),
];

/** An accepted record, ADR 0005, with this body, next to the chain. */
const citing = (body, options) => [...CHAIN(), fixture('0005', 'citer', 'accepted.', body, options)];

test('the chain of the fixtures is clean, so a problem below is the citer\'s', () => {
  assert.deepEqual(problemsIn(CHAIN()), []);
});

test('an accepted record\'s citation of a superseded record passes with the form that names the end of the chain', () => {
  const cases = [
    ['a link, with the link form', 'See [ADR 0001](0001-old-way.md) (superseded, now [ADR 0003](0003-new-way.md)).'],
    ['a bare citation, with the bare form', 'The ask goes as ADR 0001 (superseded, now ADR 0003) said.'],
    ['a citation of the middle of the chain', 'As ADR 0002 (superseded, now ADR 0003) said.'],
    ['a possessive, with the form after the \'s', 'This adds to ADR 0001\'s (superseded, now ADR 0003) list.'],
    ['a linked possessive', 'This adds to [ADR 0001](0001-old-way.md)\'s (superseded, now [ADR 0003](0003-new-way.md)) list.'],
    ['a record in force, with no form', 'As ADR 0003 and [ADR 0004](0004-other-way.md) say.'],
  ];
  for (const [name, body] of cases) assert.deepEqual(problemsIn(citing(body)), [], name);
  assert.deepEqual(
    problemsIn(citing('The road.', { decidedBy: 'the owner, as [ADR 0001](0001-old-way.md) (superseded, now [ADR 0003](0003-new-way.md)) records.' })),
    [],
    'in the Decided by: line, with the form',
  );
});

test('an accepted record\'s citation of a superseded record fails without the form, or with a form that is not the one', () => {
  const cases = [
    ['a bare citation with no form', 'The ask goes as ADR 0001 said.'],
    ['a link with no form', 'See [ADR 0001](0001-old-way.md).'],
    ['a form that names the next record, not the end of the chain', 'The ask goes as ADR 0001 (superseded, now ADR 0002) said.'],
    ['a form that names a record outside the chain', 'The ask goes as ADR 0001 (superseded, now ADR 0004) said.'],
    ['a bare form after a link', 'See [ADR 0001](0001-old-way.md) (superseded, now ADR 0003).'],
    ['a link form after a bare citation', 'As ADR 0001 (superseded, now [ADR 0003](0003-new-way.md)) said.'],
    ['a form before the \'s', 'This adds to ADR 0001 (superseded, now ADR 0003)\'s list.'],
    ['a form not at once after the citation', 'As ADR 0001 said (superseded, now ADR 0003).'],
    ['a form with a word changed', 'As ADR 0001 (replaced, now ADR 0003) said.'],
    ['a form with a full stop in it', 'As ADR 0001 (superseded, now ADR 0003.) said.'],
    ['two citations, one with the form and one without', 'As ADR 0001 (superseded, now ADR 0003) said, and ADR 0002 too.'],
  ];
  for (const [name, body] of cases) {
    const problems = problemsIn(citing(body));
    assert.ok(
      problems.some((problem) => /^docs\/prd\/adr\/0005-citer\.md:\d+: .*ADR 000[12]/.test(problem)),
      `${name}: should be a problem of 0005-citer.md, got: ${problems.join('\n') || 'none'}`,
    );
  }
  const decided = problemsIn(citing('The road.', { decidedBy: 'the owner, as [ADR 0001](0001-old-way.md) records.' }));
  assert.ok(decided.some((problem) => /0005-citer\.md:9: /.test(problem)), `the Decided by: line is in scope: ${decided.join('\n') || 'none'}`);
});

test('an accepted record\'s citation in a left-out place needs no form', () => {
  assert.deepEqual(
    problemsIn(citing('The road.', { history: '- 2026-10-09: made; it keeps what ADR 0001 said.' })),
    [],
    'in the History section',
  );
  assert.deepEqual(
    problemsIn([...CHAIN(), fixture('0005', 'citer', 'accepted. It keeps what ADR 0001 said.')]),
    [],
    'in the header Status line',
  );
  // ADR 0003 supersedes ADR 0002, which superseded ADR 0001.
  const own = CHAIN().map((record) => (record.number !== '0003' ? record : fixture('0003', 'new-way', 'accepted.', 'ADR 0002 kept the road, and [ADR 0001](0001-old-way.md) made it.', { supersedes: [['0002', 'mid-way']] })));
  assert.deepEqual(problemsIn(own), [], 'a record it supersedes, directly or down the chain');
});

test('the form is wrong wherever the rule does not ask for it', () => {
  const strays = (all, rel, name) => {
    const problems = problemsIn(all);
    assert.ok(problems.some((problem) => problem.startsWith(`docs/prd/adr/${rel}:`)), `${name}: should be a problem of ${rel}, got: ${problems.join('\n') || 'none'}`);
  };
  strays(citing('As ADR 0004 (superseded, now ADR 0003) says.'), '0005-citer.md', 'after a record that is not superseded');
  strays(citing('As [ADR 0003](0003-new-way.md) (superseded, now [ADR 0003](0003-new-way.md)) says.'), '0005-citer.md', 'after the record in force itself');
  strays(citing('The road.', { history: '- 2026-10-09: made; it keeps what ADR 0001 (superseded, now ADR 0003) said.' }), '0005-citer.md', 'in the History section');
  strays(
    CHAIN().map((record) => (record.number !== '0003' ? record : fixture('0003', 'new-way', 'accepted.', 'ADR 0002 (superseded, now ADR 0003) kept the road.', { supersedes: [['0002', 'mid-way']] }))),
    '0003-new-way.md',
    'after a record the citer supersedes itself',
  );
  strays(
    CHAIN().map((record) => (record.number !== '0002' ? record : fixture('0002', 'mid-way', 'superseded by [ADR 0003](0003-new-way.md).', 'As ADR 0001 (superseded, now ADR 0003) said.', { supersedes: [['0001', 'old-way']] }))),
    '0002-mid-way.md',
    'in a superseded record, which keeps its text',
  );
});

test('an accepted record\'s citation of a superseded record whose chain leads to no record in force fails', () => {
  const nowhere = [
    fixture('0001', 'old-way', 'superseded.'),
    fixture('0002', 'citer', 'accepted.', 'The ask goes as ADR 0001 said.'),
  ];
  const problems = problemsIn(nowhere);
  assert.ok(problems.some((problem) => /^docs\/prd\/adr\/0002-citer\.md:\d+: cites ADR 0001, which is superseded/.test(problem)), problems.join('\n') || 'none');

  // A Status that names a successor which is not in docs/prd/adr/ is no chain either.
  const gone = [
    fixture('0001', 'old-way', 'superseded by [ADR 0009](0009-not-there.md).'),
    fixture('0002', 'citer', 'accepted.', 'The ask goes as ADR 0001 said.'),
  ];
  assert.ok(problemsIn(gone).some((problem) => problem.startsWith('docs/prd/adr/0002-citer.md:')), `a successor that is not there: ${problemsIn(gone).join('\n') || 'none'}`);
});

test('a record that is not accepted, and any other file, citing a superseded record fails, form or not', () => {
  const proposed = fixture('0005', 'citer', 'proposed.', 'The ask goes as ADR 0001 (superseded, now ADR 0003) said.');
  const doc = { rel: 'docs/prd/prd.md', text: 'The ask goes as ADR 0001 said.\n' };
  const formed = { rel: 'README.md', text: 'The ask goes as ADR 0001 (superseded, now ADR 0003) said.\n' };
  const code = { rel: 'src/message.js', text: '// the road (ADR 0001)\n' };

  assert.ok(
    problemsIn([...CHAIN(), proposed]).some((problem) => problem.startsWith('docs/prd/adr/0005-citer.md:')),
    'a proposed record can still be edited, so it names the record in force',
  );
  const others = problemsIn(CHAIN(), [doc, formed, code]);
  assert.deepEqual(others.map((one) => one.split(':')[0]), ['docs/prd/prd.md', 'README.md', 'src/message.js'], `a doc, the README with the form, and the code: ${others.join('\n')}`);
  assert.deepEqual(problemsIn(CHAIN(), [{ rel: 'docs/prd/prd.md', text: 'As ADR 0003 says.\n' }]), [], 'the contrast: a doc citing the record in force');
});

test('the records are in docs/prd/adr/ under the names they had, and docs/adr/ is gone', async () => {
  assert.equal(await kindOf(ADR_FOLDER), 'folder', `${ADR_FOLDER}/ should hold the decision records`);
  const missing = [];
  for (const name of RECORDS_BEFORE_THE_MOVE) {
    if (await kindOf(`${ADR_FOLDER}/${name}`) !== 'file') missing.push(name);
  }
  assert.deepEqual(missing, [], `these records should be in ${ADR_FOLDER}/ under the same name`);
  assert.equal(await kindOf(OLD_FOLDER), 'absent', `${OLD_FOLDER}/ should no longer exist: the records are in ${ADR_FOLDER}/`);
  for (const rel of ['docs/tech-notes.md', 'docs/proposals']) assert.ok(await exists(rel), `${rel} should stay where it is`);
});

test('nothing in the repo names or links the records\' old place, docs/adr/', async () => {
  const problems = new Set();
  for (const rel of await repoFiles()) {
    if (NAME_THE_OLD_PLACE.has(rel) || isSignedRequestRecord(rel)) continue;
    const text = await readFile(path.join(repoRoot, rel), 'utf8');
    for (const match of text.matchAll(/\bdocs\/adr\b/g)) {
      const line = lineAt(text, match.index);
      problems.add(`${rel}:${line}: ${text.split('\n')[line - 1].trim()}`);
    }
    if (!rel.endsWith('.md')) continue;
    for (const link of linkTargetsIn(text, rel)) {
      if (link.resolved === OLD_FOLDER || link.resolved.startsWith(`${OLD_FOLDER}/`)) problems.add(`${rel}:${link.line}: links ${link.target}`);
    }
  }
  assert.deepEqual([...problems], [], `these still name or link the old place; the records are in ${ADR_FOLDER}/`);
});

test('every record starts with al\'s status line, which agrees with its header Status line', async () => {
  const all = await records();
  assert.ok(all.length >= RECORDS_BEFORE_THE_MOVE.length, `${ADR_FOLDER}/ should hold at least the ${RECORDS_BEFORE_THE_MOVE.length} records there were, got ${all.length}`);

  const problems = [];
  for (const record of all) {
    const first = record.lines[0];
    if (!AL_STATUS.test(first)) problems.push(`${record.rel}:1: should be al's \`Status: accepted\`, \`Status: proposed\` or \`Status: superseded by ADR-<n>\`, got: ${first}`);
    const word = /^(\w+)/.exec(record.status ?? '')?.[1];
    if (word === undefined) {
      problems.push(`${record.rel}: no header \`Status:\` line below the title`);
      continue;
    }
    if (word === 'superseded' && record.successors.length === 0) {
      problems.push(`${record.rel}:${record.statusLine}: the header Status says superseded and links no record as [ADR NNNN](NNNN-slug.md)`);
      continue;
    }
    const expected = word === 'superseded'
      ? `Status: superseded by ${record.successors.map((successor) => `ADR-${alNumber(successor.number)}`).join(', ')}`
      : `Status: ${word}`;
    if (first !== expected) problems.push(`${record.rel}:1: should be \`${expected}\`, as the header Status line says (${record.status}), got: ${first}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every record has al\'s marker on line 3 and its title on line 5, with empty lines between', async () => {
  const all = await records();
  assert.ok(all.length >= RECORDS_BEFORE_THE_MOVE.length, `${ADR_FOLDER}/ should hold at least the ${RECORDS_BEFORE_THE_MOVE.length} records there were, got ${all.length}`);

  const problems = [];
  for (const record of all) {
    const n = alNumber(record.number);
    const marker = record.supersedes.length === 0
      ? `<!-- ADR-${n} choice -->`
      : `<!-- ADR-${n} choice supersedes:${record.supersedes.map((entry) => `ADR-${alNumber(entry.number)}`).join(',')} -->`;
    if (record.lines[1] !== '') problems.push(`${record.rel}:2: should be empty, got: ${record.lines[1]}`);
    if (record.lines[2] !== marker) problems.push(`${record.rel}:3: should be \`${marker}\`, got: ${record.lines[2]}`);
    if (record.lines[3] !== '') problems.push(`${record.rel}:4: should be empty, got: ${record.lines[3]}`);
    if (record.titleLine !== 5) problems.push(`${record.rel}: the title \`# ADR ${record.number}: <title>\` should be line 5, got line ${record.titleLine ?? 'none'}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every record is named NNNN-slug.md, is titled with its own number, and no number is used twice', async () => {
  const all = await records();
  assert.ok(all.length >= OLD_RECORDS.length, `${ADR_FOLDER}/ should hold at least the ${OLD_RECORDS.length} records there were, got ${all.length}`);

  const problems = [];
  for (const record of all) {
    const titleText = record.titleLine === null ? '(none)' : record.lines[record.titleLine - 1];
    const title = /^# ADR (\d{4}): \S/.exec(titleText);
    if (title === null) problems.push(`${record.rel}: should have the title \`# ADR ${record.number}: <title>\`, got: ${titleText}`);
    else if (title[1] !== record.number) problems.push(`${record.rel}:${record.titleLine}: the title says ADR ${title[1]}, the file name ${record.number}`);
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
      problems.push(`ADR ${number} is gone from ${ADR_FOLDER}/; a superseded record keeps its file`);
      continue;
    }
    const { supersededBy: by } = record;
    if (by === null) {
      problems.push(`${record.rel}: the status should be \`superseded by [ADR MMMM](MMMM-slug.md).\`, got: ${record.status}`);
      continue;
    }
    const target = known.get(by.number);
    if (by.fileNumber !== by.number) problems.push(`${record.rel}: the status names ADR ${by.number} but links ${by.file}`);
    else if (target === undefined || target.name !== by.file) problems.push(`${record.rel}: the status links ${by.file}, which is not in ${ADR_FOLDER}/`);
    else if (Number(by.number) <= Number(number)) problems.push(`${record.rel}: is superseded by ADR ${by.number}, which is not a newer record`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('a superseded record and the record that replaced it name each other', async () => {
  const all = await records();
  const known = byNumber(all);
  const problems = [];
  for (const record of all) {
    for (const by of record.successors) {
      const target = known.get(by.number);
      if (target !== undefined && !target.supersedes.some((entry) => entry.number === record.number)) {
        problems.push(`${record.rel}: is superseded by ADR ${by.number}, whose \`Supersedes:\` line does not name it`);
      }
    }
    for (const entry of record.supersedes) {
      const older = known.get(entry.number);
      if (entry.fileNumber !== entry.number) problems.push(`${record.rel}:${record.supersedesLine}: names ADR ${entry.number} but links ${entry.file}`);
      else if (older === undefined || older.name !== entry.file) problems.push(`${record.rel}:${record.supersedesLine}: links ${entry.file}, which is not in ${ADR_FOLDER}/`);
      else if (!older.successors.some((successor) => successor.number === record.number)) {
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
    if (!/^(?:proposed|accepted|rejected|deprecated)\b/.test(record.status ?? '')) {
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

// AssuredLoop reads a record's status only from a line that starts with
// `Status:` (#474), as obk-arch's format writes it. That holds for the header
// Status line of every record, superseded ones included; al's own first line
// is checked above.
test('every record has its header `Status:` at the start of a line', async () => {
  const all = await records();
  assert.ok(all.length >= OLD_RECORDS.length, `${ADR_FOLDER}/ should hold at least the ${OLD_RECORDS.length} records there were, got ${all.length}`);

  const problems = all
    .filter((record) => record.statusLine === null || !/^Status: \S/.test(record.lines[record.statusLine - 1]))
    .map((record) => `${record.rel}:${record.statusLine ?? '?'}: the header \`Status:\` is not at the start of a line`);
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
    for (const number of chainOf(record, known)) {
      if (!cited.has(number)) problems.push(`${record.rel}: replaces ADR ${number}, directly or down the chain, and its History has no line for it`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every accepted record follows each citation of a superseded record with the form, and no record has it where it is not asked for', async () => {
  const all = await records();
  const known = byNumber(all);
  const needed = all.flatMap((record) => formsOf(record, known).needed);
  assert.ok(needed.length > 0, 'no accepted record cites a superseded record outside the left-out places, so the check sees nothing');

  const problems = formProblems(all);
  assert.deepEqual(problems, [], `${problems.length} problems with the form \`(superseded, now …)\`:\n${problems.join('\n')}`);
});

test('every ADR cited in the repo exists and is the record in force', async () => {
  const all = await records();
  const files = [];
  for (const rel of await repoFiles()) {
    if (rel !== THIS_FILE && !isSignedRequestRecord(rel)) files.push({ rel, text: await readFile(path.join(repoRoot, rel), 'utf8') });
  }
  assert.ok(citationsOf(all, files).length > 0, 'no citation of a record was found anywhere, so the check sees nothing');

  const problems = citationProblems(all, files);
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
