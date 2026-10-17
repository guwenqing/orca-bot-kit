// SETUP.md's first-run guidance, where it disagreed with itself or with the
// kit (#576).
//
// 1. The screen table. SETUP.md section 5 and the obk-bot-building skill hold
//    the same table of first-run screens and the keys to send. Its rows for
//    Codex's `Hooks need review` and for Claude Code's `Teach auto mode` (the
//    2.1.283 form and the 2.1.289 list) gave keys, while the text below the
//    table says those two screens go through the kit, which checks the screen
//    before it types: `obk session trust-hooks` and `obk session answer` for a
//    long-lived session, `obk temp trust-hooks` and `obk temp answer` for a
//    temporary one. A reader who took the table's keys skipped those checks.
//    The decision on the shape (the developer's): both tables keep their
//    columns and rows; on those three rows the Send cell names the two kit
//    commands in backticks, with no arguments and no key; every other row keeps
//    its keys; the full commands, with their arguments, stay in the text below
//    the table. test/screen-table.test.js already holds that the two tables
//    give the same backticked Send text row for row, so the skill's rows are
//    found here by the row numbers of SETUP.md's.
//
// 2. The commands kept out of the kit's default permission set. SETUP.md
//    section 4 names the commands that keep the user's yes, and named four
//    while the kit keeps back more. `KEPT_BACK` in src/commands.js is the list
//    the kit works from (ADR 0051), so it is the expected value here: each
//    command on it is to be named in section 4's text as `obk <its words>`, the
//    three `permission …` commands together as `obk permission`. Only the text
//    outside the code blocks counts, so the `obk init --bots …` line the page
//    runs does not stand in for naming `obk init` as kept back. What is not
//    held: that section 4 names nothing else as kept back. The section may
//    name other obk commands for other reasons, and nothing here can tell
//    which list a sentence puts a command on.
//
// 3. The Orca status guidance (section 1 after `orca status --json`, and
//    section 6 on an `obk health` error saying Orca is not answering) is not
//    held here. It is advice to a reader on how to read an error, with nothing
//    in it a machine runs or the kit reads, and a test could only pin its
//    wording. Review checks it against the issue.
//
// Also not held: the sentence before each table that says how to send a row.
// It is prose for the reader, and the rows themselves are what is held.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import * as commands from '../src/commands.js';
import { repoRoot } from './helpers/cli.js';

const SETUP = { file: 'SETUP.md', section: '## 5. Answer what the tabs ask' };
const SKILL = { file: 'skills/obk-bot-building/SKILL.md', section: '## When a tab it opened is waiting' };

/** How the screen table's header starts, as test/screen-table.test.js reads it. */
const HEADER_START = '| On screen | Send | Which is |';

/** The kit commands each screen's Send cell is to name, and nothing else. */
const HOOKS_COMMANDS = ['obk session trust-hooks', 'obk temp trust-hooks'];
const TEACH_COMMANDS = ['obk session answer', 'obk temp answer'];

const pageAt = (file) => readFile(path.join(repoRoot, file), 'utf8');

/** The lines of one `## ` section of a page, without its heading. It fails if the heading is not there. */
function sectionOf(page, file, heading) {
  const lines = page.split('\n');
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  assert.notEqual(start, -1, `${file} should have the section "${heading}"`);
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end);
}

/** A markdown table line's cells, trimmed. A pipe escaped as `\|` stays inside its cell. */
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim());

/** The text inside each pair of backticks in a cell. */
const backticked = (cell) => [...cell.matchAll(/`([^`]*)`/g)].map((match) => match[1]);

/** The screen table on one page: one entry per row, with its cells by header name. */
async function tableIn({ file, section }) {
  const body = sectionOf(await pageAt(file), file, section);
  const at = body.findIndex((line) => line.startsWith(HEADER_START));
  assert.notEqual(at, -1, `${file}, "${section}", should hold the screen table, its header starting \`${HEADER_START}\``);

  const header = cellsOf(body[at]);
  const rows = [];
  for (let index = at + 2; index < body.length && body[index].trim().startsWith('|'); index += 1) {
    const cells = cellsOf(body[index]);
    const row = Object.fromEntries(header.map((name, column) => [name, cells[column] ?? '']));
    rows.push({ row, label: `${file}, row ${rows.length + 1} (${cells[0]})` });
  }
  assert.ok(rows.length > 0, `${file}: the screen table has no rows`);
  return rows;
}

/**
 * The row numbers (from 0) of the screens the kit answers, found by SETUP.md's
 * On screen wording: one row for Codex's hooks review, two for Claude Code's
 * Teach auto mode. The skill's table gives the same rows in the same order.
 */
function kitRowsOf(setupRows) {
  const hooks = setupRows.flatMap(({ row }, index) => (/Codex/.test(row['On screen']) && /Hooks need review/.test(row['On screen']) ? [index] : []));
  const teach = setupRows.flatMap(({ row }, index) => (/Claude Code/.test(row['On screen']) && /Teach auto mode/.test(row['On screen']) ? [index] : []));
  assert.equal(hooks.length, 1, `SETUP.md's screen table should have one row for Codex's \`Hooks need review\`, found ${hooks.length}`);
  assert.equal(teach.length, 2, `SETUP.md's screen table should have two rows for Claude Code's \`Teach auto mode\` (the 2.1.283 form and the 2.1.289 list), found ${teach.length}`);
  return { hooks, teach };
}

const bothTables = async () => ({ setup: await tableIn(SETUP), skill: await tableIn(SKILL) });

/**
 * What is wrong with one Send cell that is to name exactly the given kit
 * commands, in backticks, with no arguments and no key: a list of problems,
 * empty when it is right.
 */
function sendCellProblems({ row, label }, expected) {
  const found = backticked(row.Send);
  const problems = [];
  for (const text of found) {
    if (/\\|[\x00-\x1f\x7f]/.test(text)) problems.push(`${label}: \`${text}\` in the Send cell is a key; the kit answers this screen`);
    else if (!expected.includes(text)) problems.push(`${label}: \`${text}\` in the Send cell is not one of ${expected.map((one) => `\`${one}\``).join(', ')}`);
  }
  for (const command of expected) {
    if (!found.includes(command)) problems.push(`${label}: the Send cell should name \`${command}\`, got: ${row.Send}`);
  }
  return problems;
}

/** The kit commands named are commands the CLI has, so a rename in the CLI shows here. */
function assertCliHas(expected) {
  const known = Object.keys(commands.COMMANDS ?? {});
  for (const command of expected) {
    const words = command.replace(/^obk /, '');
    assert.ok(known.includes(words), `\`${command}\` should be a command of the CLI (src/commands.js COMMANDS), and it is not`);
  }
}

test('FG1 the Codex `Hooks need review` row of both screen tables sends the reader to obk session trust-hooks and obk temp trust-hooks, not to keys', async () => {
  // Issue #576, item 1. The kit's trust-hooks commands check that the hooks on
  // the review are the kit's own before they trust them; keys trust whatever
  // is on the review.
  assertCliHas(HOOKS_COMMANDS);
  const { setup, skill } = await bothTables();
  const { hooks } = kitRowsOf(setup);

  const problems = hooks.flatMap((index) => [
    ...sendCellProblems(setup[index], HOOKS_COMMANDS),
    ...(skill[index] ? sendCellProblems(skill[index], HOOKS_COMMANDS) : [`${SKILL.file}: no row ${index + 1}, the hooks row in SETUP.md`]),
  ]);
  assert.deepEqual(problems, [], `the hooks review row should name the kit's commands and no key:\n${problems.join('\n')}`);
});

test('FG2 both Claude Code `Teach auto mode` rows of both screen tables send the reader to obk session answer and obk temp answer, not to keys', async () => {
  // Issue #576, item 1. The kit's answer commands answer only the two shapes
  // they know exactly, and on the 2.1.289 list send the return only after a
  // second look; keys sent from the table make neither check.
  assertCliHas(TEACH_COMMANDS);
  const { setup, skill } = await bothTables();
  const { teach } = kitRowsOf(setup);

  const problems = teach.flatMap((index) => [
    ...sendCellProblems(setup[index], TEACH_COMMANDS),
    ...(skill[index] ? sendCellProblems(skill[index], TEACH_COMMANDS) : [`${SKILL.file}: no row ${index + 1}, a Teach auto mode row in SETUP.md`]),
  ]);
  assert.deepEqual(problems, [], `the Teach auto mode rows should name the kit's commands and no key:\n${problems.join('\n')}`);
});

test('FG3 every other row of both screen tables still gives keys, and names no obk command', async () => {
  // The kit answers only those two screens. The folder trust, `/new`, update
  // and oh-my-zsh screens have no kit command, so their rows keep the keys a
  // reader sends. This guards a part that is already right.
  const { setup, skill } = await bothTables();
  const { hooks, teach } = kitRowsOf(setup);
  const kitRows = new Set([...hooks, ...teach]);

  const problems = [];
  for (const rows of [setup, skill]) {
    rows.forEach(({ row, label }, index) => {
      if (kitRows.has(index)) return;
      const found = backticked(row.Send);
      if (found.length === 0) problems.push(`${label}: the Send cell gives no key in backticks: ${row.Send}`);
      for (const text of found) {
        if (/^obk\b/.test(text)) problems.push(`${label}: \`${text}\` names a kit command on a screen the kit does not answer`);
      }
    });
  }
  assert.deepEqual(problems, [], `rows the kit does not answer should keep their keys:\n${problems.join('\n')}`);
});

test('FG4 the text of both sections still gives the four kit commands with their arguments', async () => {
  // The table cell names a command without its arguments, so the reader takes
  // the full command from the text below the table. This guards a part that
  // is already right. A line break inside a command counts as a space, and a
  // placeholder such as `<their path>` counts as one argument.
  const problems = [];
  for (const { file, section } of [SETUP, SKILL]) {
    const text = sectionOf(await pageAt(file), file, section).join('\n').replace(/\s+/g, ' ');
    for (const command of [...HOOKS_COMMANDS, ...TEACH_COMMANDS]) {
      const withArguments = new RegExp(`${command} --bots (?:<[^>]*>|\\S+) --`);
      if (!withArguments.test(text)) problems.push(`${file}, "${section}": no \`${command} --bots … --…\` with its arguments`);
    }
  }
  assert.deepEqual(problems, [], `the full kit commands should stay in the text:\n${problems.join('\n')}`);
});

test('FG5 SETUP.md section 4 names every command the kit keeps out of its default permission set', async () => {
  // Issue #576, item 2. The reader tells the user which commands keep their
  // yes; a command missing from the page is one the user is told nothing
  // about. The expected list is the kit's own KEPT_BACK.
  const { KEPT_BACK } = commands;
  assert.ok(Array.isArray(KEPT_BACK) && KEPT_BACK.length > 0, `src/commands.js should export KEPT_BACK, a list, got: ${JSON.stringify(KEPT_BACK)}`);

  const lines = sectionOf(await pageAt('SETUP.md'), 'SETUP.md', '## 4. Make the fleet');
  let inside = false;
  const prose = lines.filter((line) => {
    if (line.startsWith('```')) {
      inside = !inside;
      return false;
    }
    return !inside;
  }).join('\n').replace(/\s+/g, ' ');

  const missing = KEPT_BACK
    .map((command) => (command.startsWith('permission ') ? 'permission' : command))
    .filter((words, index, all) => all.indexOf(words) === index)
    .filter((words) => !new RegExp(`\\bobk ${words}(?![\\w-])`).test(prose))
    .map((words) => `obk ${words}`);
  assert.deepEqual(missing, [], `SETUP.md section 4 should name every command kept out of the default set (KEPT_BACK: ${KEPT_BACK.join(', ')}); it does not name: ${missing.join(', ')}`);
});
