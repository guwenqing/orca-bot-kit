// One line the kit's limits unit carries, word for word (issue #763). A
// session that copies a tool result its harness saved (a file in the
// harness's own folder, outside the work dir) with a shell command can stop
// on a permission dialog until a person answers. The line tells the session
// and its helpers to use the harness's read tool on such a file instead.
//
// The line is a paragraph of its own in the limits unit ("What needs a yes"),
// right after the paragraph on a refused call. What is checked is what a bot
// is given:
//
//   - the AGENTS.md the kit builds for a new bot, under the limits unit's
//     heading, for a bot on each harness the kit builds rules for: Claude
//     Code, Codex and Pi;
//   - for a Claude Code bot, also the CLAUDE.md the kit builds for it. A
//     helper (subagent) does not get the appended system text, only the
//     instruction files, so the line must be in CLAUDE.md itself.
//
// The units wrap their lines, so text is compared with its whitespace
// collapsed, and a paragraph is what lies between blank lines. Every run is
// in the sandbox (helpers/cli.js) with the fake Orca; nothing here reaches a
// real harness.

import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { botHomeOf, createSandbox } from './helpers/cli.js';
import { agentsIn, blockIn, headingsIn, kitUnit, underIn } from './helpers/rules.js';

/** Whitespace collapsed to single spaces, ends trimmed: a wrapped line reads as one. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** The paragraphs of a section body, each one flattened. */
const paragraphsOf = (body) => body.split(/\n[ \t]*\n/).map(flat).filter((one) => one !== '');

/** The line, word for word. */
const SAVED_RESULT = 'Use your harness\'s read tool on a tool result it saved. '
  + 'A shell copy of it can stop your tab.';

/** The start of the paragraph the line comes right after. */
const REFUSED = 'When your harness\'s permission layer refuses a call, do not do the same act another way';

/** The harnesses the kit builds rules for. */
const HARNESSES = ['claude', 'codex', 'pi'];

/** A name that appears in no sentence of the kit's own. */
const BOT = 'quill-bot';

/** A hard limit for each test, so a wait that never ends fails rather than hangs. */
const LIMIT = { timeout: 120_000 };

/** A sandbox with a bots folder and one new bot on `harness`: the sandbox and the bots folder's path. */
async function newBot(t, harness) {
  const box = await createSandbox(t);
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, `${init.stdout}${init.stderr}`);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  return { box, bots: box.path('bots') };
}

/** The limits unit's section in a block body, failing with the headings when it is not there. */
async function limitsIn(body, what) {
  const { title } = await kitUnit('limits');
  const under = underIn(body, title);
  assert.ok(under !== undefined, `${what} should carry the limits unit under "${title}", got headings: ${headingsIn(body)}`);
  return { title, under };
}

/** The line is in the section word for word, and is the whole paragraph right after the refused-call paragraph. */
function assertLineInPlace(under, title, what) {
  assert.ok(
    flat(under).includes(SAVED_RESULT),
    `${what}: "${title}" should hold, word for word:\n${SAVED_RESULT}\ngot:\n${under}`,
  );
  const paragraphs = paragraphsOf(under);
  const at = paragraphs.findIndex((one) => one.startsWith(REFUSED));
  assert.notEqual(
    at,
    -1,
    `${what}: a paragraph of "${title}" should start with ${JSON.stringify(REFUSED)}, got:\n${paragraphs.join('\n\n')}`,
  );
  assert.equal(
    paragraphs[at + 1],
    SAVED_RESULT,
    `${what}: the paragraph right after the refused-call paragraph should be the line alone; paragraphs:\n${paragraphs.join('\n\n')}`,
  );
}

for (const harness of HARNESSES) {
  test(`a new ${harness} bot's AGENTS.md carries the saved-result line in limits, right after the refused-call paragraph (#763)`, LIMIT, async (t) => {
    const { bots } = await newBot(t, harness);
    const what = `the ${harness} bot's AGENTS.md`;
    const { title, under } = await limitsIn(blockIn(await agentsIn(bots, BOT)).body, what);
    assertLineInPlace(under, title, what);
  });
}

test('a new claude bot\'s CLAUDE.md, the file its helpers load, carries the saved-result line in limits, in its place (#763)', LIMIT, async (t) => {
  const { box, bots } = await newBot(t, 'claude');
  // A bot is a Claude Code bot when a session of it runs on Claude Code; the
  // build then writes CLAUDE.md as a file of its own.
  const session = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt', 'Keep the notes.']);
  assert.equal(session.code, 0, `${session.stdout}${session.stderr}`);
  const build = await box.run(['rules', 'build', '--bots', 'bots']);
  assert.equal(build.code, 0, `${build.stdout}${build.stderr}`);
  const file = path.join(botHomeOf(bots, BOT), 'CLAUDE.md');
  const kind = await lstat(file).then((stat) => (stat.isSymbolicLink() ? 'a link' : 'a regular file'), () => 'nothing');
  assert.equal(kind, 'a regular file', `the premise: the kit builds CLAUDE.md for a Claude Code bot as a file of its own, got ${kind}`);
  const what = 'the claude bot\'s CLAUDE.md';
  const { title, under } = await limitsIn(blockIn(await readFile(file, 'utf8')).body, what);
  assertLineInPlace(under, title, what);
});
