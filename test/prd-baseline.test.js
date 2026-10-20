// The PRD as AssuredLoop's baseline (#474). AssuredLoop reads the spec from a
// folder of its own, the spec root, so the PRD moved from docs/prd.md to
// docs/prd/prd.md, and that folder holds it and none of the rest of the docs:
// the decision records stay in docs/adr/.
//
// What can break in a move like this is the links. Every place that named the
// old path follows the move; the PRD's own relative links still resolve from
// its new folder; and a link to a heading inside the PRD still lands on a
// heading there, the one it names (an ID in a heading is part of it, so it
// changes the anchor).
//
// The PRD's text is otherwise unchanged by the move. That is a property of the
// change, not of the repo, and is left to the review of the diff: a test of it
// would forbid every later edit of the PRD.
//
// AssuredLoop 1.0.0 (#667) names the spec root in another place. In 0.1.0,
// `.assuredloop` at the repo root was a file with the line `root: docs/prd`.
// al 1.0.0 does not read that file: each al command stops on it. Its settings
// are in the folder `.assuredloop/`: `config.yaml` is a YAML map whose `root:`
// is the spec folder, and whose `docs:` may list each file with its ID prefix.
// Beside it are `schema.yaml` (the kinds and the link words) and `records/`.
// The root is still docs/prd. The markers in the PRD are tested in
// prd-markers.test.js.
//
// The records of 0.1.0 stay as they are, as files under requests/archive/
// (#667): al 1.0.0 does not read them, and the pinned 0.1.0 reads them at
// their commits. They are dated records, which no later change edits. So
// their bytes are pinned here, one hash for each request folder. A request
// that is archived later, under either version, adds a folder of its own and
// is not pinned.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { repoRoot, snapshot } from './helpers/cli.js';

/** Trees that hold copies of other people's files, or of our own. */
const IGNORED = new Set(['node_modules', '.git', '.stryker-tmp', 'reports']);

const OLD_PRD = 'docs/prd.md';
const NEW_PRD = 'docs/prd/prd.md';
const BASELINE_ROOT = 'docs/prd';
const SETTINGS_DIR = '.assuredloop';
const CONFIG = '.assuredloop/config.yaml';
const SCHEMA = '.assuredloop/schema.yaml';
const RECORDS = '.assuredloop/records';
const ARCHIVE = 'requests/archive';

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

/** Whether a path in the repo is a folder, a file, or neither. */
async function kindOf(rel) {
  const found = await stat(path.join(repoRoot, rel)).catch(() => null);
  if (found === null) return 'absent';
  return found.isDirectory() ? 'folder' : 'file';
}

/** A YAML file of the repo as its value, read with the yaml package. */
async function readYaml(rel) {
  assert.equal(await kindOf(rel), 'file', `${rel} should be a file`);
  const text = await readFile(path.join(repoRoot, rel), 'utf8');
  let value;
  assert.doesNotThrow(() => { value = parse(text); }, `${rel} should be valid YAML`);
  return value;
}

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A folder named in config, written as al reads it: no `./` in front, no `/` at the end. */
const folderOf = (value) => path.posix.normalize(String(value)).replace(/\/+$/, '');

/** `.assuredloop/config.yaml` as a map. */
async function readConfig() {
  const config = await readYaml(CONFIG);
  assert.ok(isMap(config), `${CONFIG} should be a YAML map of settings, got: ${JSON.stringify(config)}`);
  return config;
}

/**
 * A hash of a folder's files: each file's path inside the folder and the hash
 * of its bytes (or where a symlink leads), in the order of the paths. A file
 * added, removed, renamed or edited changes it. A folder with no file in it
 * does not count, as git keeps none.
 */
async function folderHash(dir) {
  const tree = await snapshot(dir, (child) => path.basename(child) === '.DS_Store');
  const hash = createHash('sha256');
  for (const child of Object.keys(tree).filter((name) => tree[name] !== 'dir').sort()) hash.update(`${child}\0${tree[child]}\n`);
  return hash.digest('hex');
}

/** The requests archived under al 0.1.0, each with the hash of its folder at the move to 1.0.0. */
const ARCHIVED_UNDER_0_1_0 = [
  ['assuredloop-in-prd', '063d1af66ba023564be613b6cfdfd8551102dd4b6257ffdd8d329620b4c8765b'],
  ['bot-father-changes-bots', '080d4497de1de88ab82392276e5c52a2266b007c033227c95af5844c33158b7b'],
  ['default-rules-after-mail-road', '1beb261317005d92f7965daee13ead1181ec7f0dcc6fbc062119067ce75db57e'],
  ['fleet-mail-one-road', '7344f59103f91b533de9aad34b69022579b63728ea05e9231331767aa63697ea'],
  ['fleet-mail-one-signal', 'f1cbfbdfd626f98d40e3d1d68c73a46c7a2d1ace4f5feb9d4cf253ec7d19ee5e'],
  ['kit-commands-allowed', '376356311b008b1bea2264fee5a716c90e13aeced5f11eb595a0ce3359bf6719'],
  ['orca-host-and-default-rules-records', 'b0ddf3e0fa6905e70ff376c7faf3337dc18555858d4cb46c654f6d72bae97139'],
  ['pi-mail', '0f078f6fbc2a1c23ceab10ec4f6f4e8de83c0ba487f0eff092cfa8d815c37cf4'],
  ['pi-new', '609944277ea6e94fed06582ca98907e23ba03d044dbe7243d334328072457759'],
  ['pi-rules-skills', '386b84cb59049fb845fa8b017d73d89c790d74541a6754c0fab49c9e2705c8d0'],
  ['pi-session', '887a5fd60690e6d5ba35dcfb7ae9e5f4b58523fa61c3ded618f70ef02a7144fc'],
  ['pi-temp', '4c8ad01f7956eb1019616f53b11f76502d8c21c5735f4f23afafd2ef3e784467'],
  ['restart-bot-create-kept-back', 'feaa3dbf4180813962329067917970ed18a537e1c5db26d02f13623ffc28af3a'],
  ['retire-stops-processes', '274bf5c5885fed40b9ea7aa3becc4fc80799356b7ff4830b0bdca53fba9e3352'],
  ['session-clear', 'fa7b524c1652e43bc832002a228c74bad23957a2bfe14a13c1e908623257dc62'],
  ['session-first-run', '04bc46b48547b00421584a1137bc1686f58c92b914c8bb1eedd07688d2715e1e'],
  ['test-out-of-core', 'f2d198105ec5a06cb18ee4bda059877ca6784db09785705558eb45e16ccda7db'],
];

test('the anchor rule gives the anchors GitHub gives', () => {
  // The one CONTRIBUTING.md links to today (the README until #652).
  assert.equal(slug('7.3 Decided rules inside the skills'), '73-decided-rules-inside-the-skills');
  assert.equal(slug('6.6 Rules and `AGENTS.md`'), '66-rules-and-agentsmd');
  // With the tag in front, as the PRD's headings have it.
  assert.equal(slug('[PRD-12] 6.1 Something'), 'prd-12-61-something');
  assert.deepEqual(
    headingsOf('# A\n\n## B c\n\n```\n# not a heading\n```\n\n## B c\n').map((heading) => heading.anchor),
    ['a', 'b-c', 'b-c-1'],
  );
  // A hidden marker before a heading is not a heading, and does not change its anchor.
  assert.deepEqual(
    headingsOf('<!-- PRD-1 note -->\n\n# A\n\n<!-- PRD-2 note -->\n\n## [PRD-8] 6.1 Shape\n').map((heading) => heading.anchor),
    ['a', 'prd-8-61-shape'],
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

test('the folder hash changes with a file added, removed, renamed or edited, and not with nothing changed', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'obk-folder-hash-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'origin'));
  await writeFile(path.join(dir, 'request.md'), '# a request\n');
  await writeFile(path.join(dir, 'origin', 'words.md'), 'the owner said so\n');
  const first = await folderHash(dir);
  assert.equal(await folderHash(dir), first, 'nothing changed');
  await mkdir(path.join(dir, 'empty'));
  assert.equal(await folderHash(dir), first, 'an empty folder, which git does not keep');

  await writeFile(path.join(dir, 'origin', 'words.md'), 'the owner said no\n');
  const edited = await folderHash(dir);
  assert.notEqual(edited, first, 'a file edited');
  await writeFile(path.join(dir, 'origin', 'words.md'), 'the owner said so\n');
  assert.equal(await folderHash(dir), first, 'the edit undone');

  await writeFile(path.join(dir, 'extra.md'), 'more\n');
  assert.notEqual(await folderHash(dir), first, 'a file added');
  await rm(path.join(dir, 'extra.md'));
  await rename(path.join(dir, 'origin', 'words.md'), path.join(dir, 'origin', 'other.md'));
  assert.notEqual(await folderHash(dir), first, 'a file renamed');
  await rm(path.join(dir, 'origin', 'other.md'));
  assert.notEqual(await folderHash(dir), first, 'a file removed');
});

test('.assuredloop at the repo root is the folder al 1.0.0 reads, not the file al 0.1.0 wrote', async () => {
  const kind = await kindOf(SETTINGS_DIR);
  assert.notEqual(kind, 'file', `${SETTINGS_DIR} is still the 0.1.0 file; al 1.0.0 stops on it. Remove it, and put the settings in ${CONFIG}`);
  assert.equal(kind, 'folder', `${SETTINGS_DIR} should be a folder at the repo root`);
});

test('.assuredloop/config.yaml is a YAML map whose root: is docs/prd', async () => {
  const config = await readConfig();
  assert.ok(Object.hasOwn(config, 'root'), `${CONFIG} should name the spec root with root:, or al reads specs/`);
  assert.equal(typeof config.root, 'string', `root: in ${CONFIG} should be one folder, got: ${JSON.stringify(config.root)}`);
  assert.equal(folderOf(config.root), BASELINE_ROOT, `root: in ${CONFIG} should be ${BASELINE_ROOT}`);
});

// `docs:` is optional. When it is there, al reads each entry as a file and the
// prefix of its IDs, and an ID is a prefix of capitals and digits, a capital
// first, then a hyphen and a number. Which prefix the PRD gets is free.
test('the docs: list of config.yaml, when it has one, gives each entry a file and an ID prefix', async () => {
  const config = await readConfig();
  if (config.docs === undefined || config.docs === null) return;
  assert.ok(Array.isArray(config.docs), `docs: in ${CONFIG} should be a list, got: ${JSON.stringify(config.docs)}`);
  const problems = [];
  for (const [at, entry] of config.docs.entries()) {
    const where = `docs[${at}]: ${JSON.stringify(entry)}`;
    if (!isMap(entry)) { problems.push(`${where}: should be a map with file and prefix`); continue; }
    if (typeof entry.file !== 'string' || entry.file === '') problems.push(`${where}: should name a file`);
    if (typeof entry.prefix !== 'string' || !/^[A-Z][A-Z0-9]*$/.test(entry.prefix)) {
      problems.push(`${where}: should give a prefix of capitals and digits, a capital first`);
    }
  }
  assert.deepEqual(problems, []);
  const prd = config.docs.filter((entry) => path.posix.normalize(entry.file) === NEW_PRD);
  assert.ok(prd.length <= 1, `docs: in ${CONFIG} should list ${NEW_PRD} once at most, got ${prd.length}`);
});

test('.assuredloop/ holds schema.yaml, a YAML map, and the folder records/, beside config.yaml', async () => {
  const schema = await readYaml(SCHEMA);
  assert.ok(isMap(schema), `${SCHEMA} should be a YAML map, got: ${JSON.stringify(schema)}`);
  assert.equal(await kindOf(RECORDS), 'folder', `${RECORDS} should be a folder`);
});

test('the folder config.yaml names holds the PRD and none of the other docs', async () => {
  const config = await readConfig();
  assert.equal(typeof config.root, 'string', `${CONFIG} should name a root`);
  const root = folderOf(config.root);
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

test('the requests archived under al 0.1.0 stay as they are, each folder byte for byte', async () => {
  const problems = [];
  for (const [name, hash] of ARCHIVED_UNDER_0_1_0) {
    const rel = path.posix.join(ARCHIVE, name);
    if (await kindOf(rel) !== 'folder') { problems.push(`${rel}: gone`); continue; }
    const now = await folderHash(path.join(repoRoot, rel));
    if (now !== hash) problems.push(`${rel}: changed (hash ${now})`);
  }
  assert.deepEqual(problems, [], 'the 0.1.0 records stay in the repo as files, as they were');
});
