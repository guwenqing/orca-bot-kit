// Reading a built `AGENTS.md` the way a test has to read it: the marked block,
// what is outside it, the sections inside it, and the kit's own units as they
// sit in the package.
//
// Two test files build bots' `AGENTS.md` — the `rules build` command and the
// commands that now build — and both need the same reading, so it lives here
// rather than twice.
//
// The checksum is opaque on purpose. What it is computed over is the
// implementer's; what a test may ask is that it is there, that it is sixteen
// hex digits, and that it moves when the block moves.

import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';

import { botHomeOf, repoRoot } from './cli.js';

/**
 * The begin marker: the word, the checksum, then a sentence for whoever opens
 * the file. The sentence is the implementer's to word; the two things the kit
 * itself has to find again are pinned here.
 */
const BEGIN = /^<!-- obk:rules ([0-9a-f]{16})\b.*-->$/;

/** The end marker, exactly: nothing of the build's own is in it. */
export const END_MARKER = '<!-- obk:rules end -->';

/** Where the markers are in a file, however many of each there turn out to be. */
function markersIn(text) {
  const lines = text.split('\n');
  const begins = [];
  const ends = [];
  lines.forEach((line, at) => {
    if (line === END_MARKER) ends.push(at);
    else if (line.startsWith('<!-- obk:rules')) begins.push(at);
  });
  return { lines, begins, ends };
}

/** Whether a file carries a block at all. */
export function hasBlock(text) {
  const { begins, ends } = markersIn(text);
  return begins.length === 1 && ends.length === 1 && begins[0] < ends[0];
}

/**
 * The block in a file, and the user's own text around it:
 * `{ checksum, body, head, tail }`. `head` and `tail` are what the build found
 * outside the markers and must hand back untouched.
 */
export function blockIn(text) {
  const { lines, begins, ends } = markersIn(text);
  assert.equal(begins.length, 1, `the file should carry exactly one obk:rules begin marker, got ${begins.length}:\n${text}`);
  assert.equal(ends.length, 1, `the file should carry exactly one obk:rules end marker, got ${ends.length}:\n${text}`);
  assert.ok(begins[0] < ends[0], `the begin marker should come before the end marker:\n${text}`);

  const found = BEGIN.exec(lines[begins[0]]);
  assert.ok(
    found !== null,
    `the begin marker should carry a 16-digit hex checksum, got: ${JSON.stringify(lines[begins[0]])}`,
  );

  return {
    checksum: found[1],
    body: lines.slice(begins[0] + 1, ends[0]).join('\n'),
    head: lines.slice(0, begins[0]).join('\n'),
    tail: lines.slice(ends[0] + 1).join('\n'),
  };
}

/** The `# <name>` line the block opens with. */
export function titleIn(body) {
  const found = body.split('\n').map((line) => /^# (.+)$/.exec(line)).find((match) => match !== null);
  assert.ok(found !== null && found !== undefined, `the block should open with a # heading naming the bot, got:\n${body}`);
  return found[1].trim();
}

/** The `## ` sections of a block, in the order they are written. */
export function sectionsIn(body) {
  const out = [];
  for (const line of body.split('\n')) {
    const heading = /^## (.+)$/.exec(line);
    if (heading !== null) out.push({ heading: heading[1].trim(), lines: [] });
    else if (out.length > 0) out.at(-1).lines.push(line);
  }
  return out.map((section) => ({ heading: section.heading, body: section.lines.join('\n').trim() }));
}

/** The headings of a block, in file order: what the build put in and where. */
export const headingsIn = (body) => sectionsIn(body).map((section) => section.heading);

/** What is written under one heading, or undefined when the heading is not there. */
export const underIn = (body, heading) => sectionsIn(body).find((section) => section.heading === heading)?.body;

/** The kit's own units, as the package ships them, in name order. */
export async function kitUnits() {
  const dir = path.join(repoRoot, 'rules');
  const names = (await readdir(dir)).filter((name) => name.endsWith('.md'));
  const units = await Promise.all(names.map(async (name) => {
    const text = await readFile(path.join(dir, name), 'utf8');
    const found = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    assert.ok(found !== null, `rules/${name} should be frontmatter then a body`);
    const data = parse(found[1]);
    return { name: data.name, title: data.title, applies: data.applies, body: found[2].trim() };
  }));
  return units.sort((one, other) => (one.name < other.name ? -1 : 1));
}

/** The units every bot carries without anyone asking, in the order they belong in. */
export const defaultUnits = async () => (await kitUnits()).filter((unit) => unit.applies === 'all');

/** One kit unit by name, for a test that names it in a list. */
export async function kitUnit(name) {
  const found = (await kitUnits()).find((unit) => unit.name === name);
  assert.ok(found !== undefined, `the kit should ship a unit called ${name}`);
  return found;
}

/** A unit file's text: the frontmatter a user unit needs, then the body. */
export const unitText = (title, body) => `---\ntitle: ${title}\n---\n\n${body}\n`;

/** Write one of the user's own units into `<bots>/rules/<name>.md`. */
export const writeUnit = (bots, name, text) => writeFile(path.join(bots, 'rules', `${name}.md`), text);

/** Add names to the `rules:` list of a `defaults.yaml` or a `bot.yaml`. */
export async function addRules(file, ...names) {
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  doc.rules = [...(doc.rules ?? []), ...names];
  await writeFile(file, stringify(doc));
}

/** Take a key out of a `bot.yaml`, which is how a test reaches a bot without a charter. */
export async function dropKey(file, key) {
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  delete doc[key];
  await writeFile(file, stringify(doc));
}

/** The `AGENTS.md` of one bot, as bytes on disk. */
export const agentsOf = (bots, bot) => path.join(botHomeOf(bots, bot), 'AGENTS.md');

/** The `AGENTS.md` of one bot, read. */
export const agentsIn = (bots, bot) => readFile(agentsOf(bots, bot), 'utf8');

/** The answer of a `--json` run, parsed, with the list every rules answer carries. */
export function answerOf(result) {
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.rules), `the answer should carry a list of rules entries, got: ${result.stdout}`);
  return answer;
}

/** The one entry about one bot. */
export function entryOf(answer, bot) {
  const found = answer.rules.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one entry should be about ${bot}, got: ${JSON.stringify(answer.rules)}`);
  return found[0];
}

/** The bots an answer reported, in the order it reported them. */
export const botsIn = (answer) => answer.rules.map((entry) => entry.bot);

/**
 * What every entry about a file that was built or left alone must say: the file
 * it is about is the bot's `AGENTS.md`, wherever the run spelled it from, and
 * `bytes` is how big that file is.
 */
export async function assertEntryFile(entry, box, bots, bot) {
  const file = agentsOf(bots, bot);
  assert.equal(
    path.resolve(box.cwd, entry.file),
    file,
    `the entry for ${bot} should be about its AGENTS.md, got: ${entry.file}`,
  );
  assert.equal(entry.bytes, (await stat(file)).size, `bytes should be the size of ${entry.file}`);
}

/** The lines of a plain report that mention one bot: its entry, however it is laid out. */
export function plainEntry(stdout, bot) {
  const lines = stdout.split('\n').filter((line) => line.includes(bot));
  assert.notEqual(lines.length, 0, `the report should carry an entry for ${bot}, got:\n${stdout}`);
  return lines.join('\n');
}
