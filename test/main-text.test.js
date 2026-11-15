// The build of a Claude Code session's main text from a recorded original, and
// the recipe it cuts by (#769; request claude-session-trim, R1 and R5; spec
// SP-10, SP-11; ADR 0055, sections 4 and 9).
//
// `src/main-text.js` exports a pure function, so a test can give it a recipe
// of its own:
//
//   buildMainText(sections, { recipe, cut }) -> { text, found, missing }
//   unitHash(text) -> the sha256 of the text, in hex
//
// `sections` is the original's list of sections. A recipe is
// `{ drop: [{ hash }], units: [{ name, hash, owner, models }] }`. A unit is a
// whole section whose unitHash is the unit's hash, or one line of a section,
// without its newline, whose unitHash is the unit's hash. `cut` is a list of
// `text:` names. The text is the sections, with every drop unit taken out and
// each cut unit taken out, joined with a blank line. `found` is the cut names
// the build found, and `missing` the cut names it did not find.
//
// The shipped recipe, `src/claude-text-recipe.json`, names its units by hash
// and by name, and holds no word of Claude Code's text.
//
// The sections here are made up. No text of Claude Code is in this file.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import { repoRoot } from './helpers/cli.js';

/** The module under test, loaded in each test, so each test says for itself that it is not there yet. */
const load = () => import('../src/main-text.js');

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** Made-up sections of an original, one of them with lines. */
const HARBOUR = 'You keep the harbour ledger and answer in short lines.';
const TOOLS = 'The tools you have:\n- ledger: read the ledger\n- bell: ring the bell\n- lamp: light the lamp';
const FOLDER = 'Work in the folder you were started in.';
const MARKER = '=== a marker between two parts ===';
const BELL_LINE = '- bell: ring the bell';

/** A recipe of the test's own: a unit for a whole section, one for a line, one for a text that is in no section, and a drop. */
const RECIPE = {
  drop: [{ hash: sha(MARKER) }],
  units: [
    { name: 'text:harbour', hash: sha(HARBOUR), owner: 'kit', models: ['claude-test-1'] },
    { name: 'text:bell', hash: sha(BELL_LINE), owner: 'kit', models: ['claude-test-1'] },
    { name: 'text:absent', hash: sha('A text that no section holds.'), owner: 'user', models: ['claude-test-1'] },
  ],
};

const sorted = (list) => [...list].sort();

describe('the main text build', () => {
  test('unitHash is the sha256 of the text, in hex', async () => {
    const { unitHash } = await load();

    assert.equal(unitHash(HARBOUR), sha(HARBOUR));
    assert.equal(unitHash(''), sha(''));
  });

  test('a whole section that a cut name names goes, and the rest is joined with a blank line', async () => {
    const { buildMainText } = await load();

    const built = buildMainText([HARBOUR, TOOLS, FOLDER], { recipe: RECIPE, cut: ['text:harbour'] });

    assert.equal(built.text, [TOOLS, FOLDER].join('\n\n'));
    assert.deepEqual(built.found, ['text:harbour']);
    assert.deepEqual(built.missing, []);
  });

  test('a line unit goes with its newline, and the other lines of its section stay', async () => {
    const { buildMainText } = await load();

    const built = buildMainText([HARBOUR, TOOLS, FOLDER], { recipe: RECIPE, cut: ['text:bell'] });

    const without = 'The tools you have:\n- ledger: read the ledger\n- lamp: light the lamp';
    assert.equal(built.text, [HARBOUR, without, FOLDER].join('\n\n'));
    assert.deepEqual(built.found, ['text:bell']);
  });

  test('a unit the recipe knows but the cut list does not name stays', async () => {
    const { buildMainText } = await load();

    const built = buildMainText([HARBOUR, TOOLS, FOLDER], { recipe: RECIPE, cut: [] });

    assert.equal(built.text, [HARBOUR, TOOLS, FOLDER].join('\n\n'), 'nothing named, nothing cut');
    assert.deepEqual(built.found, []);
    assert.deepEqual(built.missing, []);
  });

  test('a section that no unit of the recipe names stays, whatever is cut', async () => {
    const { buildMainText } = await load();

    const built = buildMainText([HARBOUR, TOOLS, FOLDER], { recipe: RECIPE, cut: ['text:harbour', 'text:bell', 'text:absent'] });

    assert.ok(built.text.includes(FOLDER), `the unnamed section stays, got:\n${built.text}`);
    assert.ok(built.text.includes('- lamp: light the lamp'), `and so does an unnamed line, got:\n${built.text}`);
  });

  test('a cut name the build does not find is in missing; the ones it finds are in found', async () => {
    const { buildMainText } = await load();

    const built = buildMainText([HARBOUR, TOOLS, FOLDER], { recipe: RECIPE, cut: ['text:harbour', 'text:absent', 'text:bell'] });

    assert.equal(built.text, ['The tools you have:\n- ledger: read the ledger\n- lamp: light the lamp', FOLDER].join('\n\n'));
    assert.deepEqual(sorted(built.found), ['text:bell', 'text:harbour']);
    assert.deepEqual(built.missing, ['text:absent']);
  });

  test('a drop unit always goes, with no cut name', async () => {
    const { buildMainText } = await load();

    const built = buildMainText([HARBOUR, MARKER, FOLDER], { recipe: RECIPE, cut: [] });

    assert.equal(built.text, [HARBOUR, FOLDER].join('\n\n'));
    assert.deepEqual(built.found, []);
    assert.deepEqual(built.missing, []);
  });

  test('a unit cut once comes back when a later build does not name it, from the same original', async () => {
    // The kit keeps the original and builds every later text from it, so a unit
    // that a later claude_keep names comes back.
    const { buildMainText } = await load();
    const original = [HARBOUR, TOOLS, FOLDER];

    const cut = buildMainText(original, { recipe: RECIPE, cut: ['text:harbour'] });
    const kept = buildMainText(original, { recipe: RECIPE, cut: [] });

    assert.ok(!cut.text.includes(HARBOUR), 'the premise: cut the first time');
    assert.equal(kept.text, [HARBOUR, TOOLS, FOLDER].join('\n\n'), 'and back the next time');
    assert.deepEqual(original, [HARBOUR, TOOLS, FOLDER], 'the build does not change the original it is given');
  });
});

// ---------------------------------------------------------------- the shipped recipe

/** The kit's own cuts (R1) and the user's cut that the recipe also names (ADR 0055, section 4). */
const KIT_UNITS = ['text:ultrareview', 'text:product-channels', 'text:fast-mode', 'text:no-planning-documents', 'text:drop-old-cautions'];
const USER_UNITS = ['text:login-tip'];

/** Every string anywhere under a value. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return [...Object.keys(value), ...Object.values(value).flatMap(stringsIn)];
  return [];
}

async function shippedRecipe() {
  const file = path.join(repoRoot, 'src', 'claude-text-recipe.json');
  return JSON.parse(await readFile(file, 'utf8'));
}

describe('the shipped recipe', () => {
  test('holds only drop and units, each entry with only its own keys', async () => {
    const recipe = await shippedRecipe();

    assert.deepEqual(Object.keys(recipe).sort(), ['drop', 'units']);
    assert.ok(Array.isArray(recipe.drop) && Array.isArray(recipe.units), `both are lists, got: ${JSON.stringify(recipe)}`);
    for (const entry of recipe.drop) assert.deepEqual(Object.keys(entry), ['hash'], `a drop entry is a hash alone, got: ${JSON.stringify(entry)}`);
    for (const unit of recipe.units) {
      assert.deepEqual(Object.keys(unit).sort(), ['hash', 'models', 'name', 'owner'], `a unit is a name, a hash, an owner and models, got: ${JSON.stringify(unit)}`);
    }
  });

  test('names the kit\'s five units as the kit\'s and text:login-tip as the user\'s, and nothing else', async () => {
    const recipe = await shippedRecipe();

    const owners = Object.fromEntries(recipe.units.map((unit) => [unit.name, unit.owner]));
    assert.deepEqual(
      owners,
      Object.fromEntries([...KIT_UNITS.map((name) => [name, 'kit']), ...USER_UNITS.map((name) => [name, 'user'])]),
    );
    assert.equal(recipe.units.length, KIT_UNITS.length + USER_UNITS.length, 'each name once');
  });

  test('holds no phrase: names, 64-hex hashes and model ids only', async () => {
    const recipe = await shippedRecipe();

    for (const unit of recipe.units) {
      assert.match(unit.name, /^text:[a-z-]+$/, `a name is text: and a word, got: ${unit.name}`);
      assert.match(unit.hash, /^[0-9a-f]{64}$/, `${unit.name}: a sha256 in hex, got: ${unit.hash}`);
      assert.ok(Array.isArray(unit.models) && unit.models.length > 0, `${unit.name}: the models it applies to, got: ${JSON.stringify(unit.models)}`);
      for (const model of unit.models) assert.match(model, /^claude-[a-z0-9.-]+$/, `${unit.name}: a model id, got: ${model}`);
    }
    for (const { hash } of recipe.drop) assert.match(hash, /^[0-9a-f]{64}$/, `a drop is a sha256 in hex, got: ${hash}`);
    const hashes = [...recipe.units.map((unit) => unit.hash), ...recipe.drop.map((one) => one.hash)];
    assert.equal(new Set(hashes).size, hashes.length, 'no hash twice');
    for (const text of stringsIn(recipe)) {
      assert.ok(!/\s/.test(text), `no string holds a space, so none is a phrase, got: ${JSON.stringify(text)}`);
      assert.ok(text.length <= 64, `no long string, got: ${JSON.stringify(text)}`);
    }
  });
});
