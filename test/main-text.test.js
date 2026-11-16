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
// The parts that Claude Code adds by itself after a replaced main text (#784,
// ADR 0061) are a third list of the recipe, `back: [{ name, hash, models }]`.
// The build takes out each back unit it finds, as a whole section or one line,
// whatever `cut` holds, and gives back `back`, the back names it took out, in
// the order found. A back name is never in `missing`.
//
//   partsTrouble(sections, { main, back, recipe }) -> undefined | { twice, without }
//
// reads a record's first sections against the kit's main file `main`: undefined
// when the first section is not `main`; else `twice`, `{ size, sum }` (the first
// 16 hex of the sha256) for each later section whose text is in `main`, in
// order; and `without`, each name of `back` whose hash is not the hash of a
// later section, nor of a line of one.
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

/** Made-up parts that Claude Code would add by itself: a whole section, and one line of the tools section. */
const LAMP_NOTICE = 'The lamp tool lights the harbour lamp; light it only at dusk.';
const LAMP_LINE = '- lamp: light the lamp';

/** The test's own recipe with a back list: one back section and one back line. */
const WITH_BACK = {
  ...RECIPE,
  back: [
    { name: 'text:lamp-notice', hash: sha(LAMP_NOTICE), models: ['claude-test-1'] },
    { name: 'text:lamp-line', hash: sha(LAMP_LINE), models: ['claude-test-1'] },
  ],
};

/** The tools section without the back line. */
const TOOLS_WITHOUT_LAMP = 'The tools you have:\n- ledger: read the ledger\n- bell: ring the bell';

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

// ---------------------------------------------------------------- the parts that come back (#784)

describe('the build takes out the parts that Claude Code adds by itself (#784)', () => {
  test('a back section goes with an empty cut list, and back names it; found and missing do not', async () => {
    const { buildMainText } = await load();

    const built = buildMainText([HARBOUR, LAMP_NOTICE, FOLDER], { recipe: WITH_BACK, cut: [] });

    assert.equal(built.text, [HARBOUR, FOLDER].join('\n\n'));
    assert.deepEqual(built.back, ['text:lamp-notice']);
    assert.deepEqual(built.found, []);
    assert.deepEqual(built.missing, []);
  });

  test('a back line goes with its newline, and the other lines of its section stay', async () => {
    const { buildMainText } = await load();

    const built = buildMainText([HARBOUR, TOOLS, FOLDER], { recipe: WITH_BACK, cut: [] });

    assert.equal(built.text, [HARBOUR, TOOLS_WITHOUT_LAMP, FOLDER].join('\n\n'));
    assert.deepEqual(built.back, ['text:lamp-line']);
  });

  test('a back unit goes also when the cut list names it, beside a cut unit', async () => {
    const { buildMainText } = await load();

    const built = buildMainText([HARBOUR, LAMP_NOTICE, FOLDER], { recipe: WITH_BACK, cut: ['text:lamp-notice', 'text:harbour'] });

    assert.equal(built.text, FOLDER);
    assert.deepEqual(built.back, ['text:lamp-notice']);
    assert.ok(built.found.includes('text:harbour'), `the cut unit is found, got: ${JSON.stringify(built.found)}`);
  });

  test('a back name that the build does not find is not in missing, whether or not the cut list names it', async () => {
    const { buildMainText } = await load();

    const named = buildMainText([HARBOUR, FOLDER], { recipe: WITH_BACK, cut: ['text:lamp-notice', 'text:lamp-line', 'text:absent'] });
    const unnamed = buildMainText([HARBOUR, FOLDER], { recipe: WITH_BACK, cut: ['text:absent'] });

    for (const built of [named, unnamed]) {
      assert.deepEqual(built.missing, ['text:absent'], 'only the cut unit is missing');
      assert.deepEqual(built.back, [], 'and no back unit was taken out');
      assert.equal(built.text, [HARBOUR, FOLDER].join('\n\n'));
    }
  });

  test('back holds the back names in the order the build found them', async () => {
    const { buildMainText } = await load();

    const notice = buildMainText([LAMP_NOTICE, TOOLS], { recipe: WITH_BACK, cut: [] });
    const line = buildMainText([TOOLS, LAMP_NOTICE], { recipe: WITH_BACK, cut: [] });

    assert.deepEqual(notice.back, ['text:lamp-notice', 'text:lamp-line']);
    assert.deepEqual(line.back, ['text:lamp-line', 'text:lamp-notice']);
  });

  test('a recipe with an empty back list gives the result of a recipe with none, and an empty back', async () => {
    const { buildMainText } = await load();

    for (const cut of [[], ['text:harbour'], ['text:bell', 'text:absent']]) {
      const before = buildMainText([HARBOUR, TOOLS, MARKER, FOLDER], { recipe: RECIPE, cut });
      const now = buildMainText([HARBOUR, TOOLS, MARKER, FOLDER], { recipe: { ...RECIPE, back: [] }, cut });

      assert.deepEqual({ text: now.text, found: now.found, missing: now.missing }, { text: before.text, found: before.found, missing: before.missing }, `cut ${JSON.stringify(cut)}`);
      assert.deepEqual(now.back, [], `cut ${JSON.stringify(cut)}: nothing came back`);
    }
  });
});

/** A made-up main file, and the kit's appended text, which the file does not hold. */
const MAIN = [HARBOUR, TOOLS, FOLDER].join('\n\n');
const APPENDED = 'Answer in the voice of the harbour master.';

/** The first 16 hex of the sha256, the sum a finding gives. */
const sum16 = (text) => sha(text).slice(0, 16);

describe('partsTrouble reads a record of a session on the kit\'s main file (#784)', () => {
  test('a record whose first section is not the main file is not a record of it: undefined', async () => {
    const { partsTrouble } = await load();

    assert.equal(partsTrouble([HARBOUR, TOOLS, FOLDER, APPENDED], { main: MAIN, back: [], recipe: WITH_BACK }), undefined, 'Claude Code\'s own sections');
    assert.equal(partsTrouble([`${MAIN}\n`, APPENDED], { main: MAIN, back: [], recipe: WITH_BACK }), undefined, 'a first section that differs by one character');
    assert.equal(partsTrouble([], { main: MAIN, back: [], recipe: WITH_BACK }), undefined, 'no section');
  });

  test('twice gives the size and the 16-hex sum of each later section that the main file holds, in order, and not the appended one', async () => {
    const { partsTrouble } = await load();

    const found = partsTrouble([MAIN, FOLDER, LAMP_NOTICE, TOOLS, APPENDED], { main: MAIN, back: [], recipe: WITH_BACK });

    assert.deepEqual(found?.twice, [
      { size: FOLDER.length, sum: sum16(FOLDER) },
      { size: TOOLS.length, sum: sum16(TOOLS) },
    ]);
  });

  test('a record with no later section that the main file holds has nothing twice', async () => {
    const { partsTrouble } = await load();

    assert.deepEqual(partsTrouble([MAIN, LAMP_NOTICE, APPENDED], { main: MAIN, back: [], recipe: WITH_BACK })?.twice, []);
    assert.deepEqual(partsTrouble([MAIN, APPENDED], { main: MAIN, back: [], recipe: WITH_BACK })?.twice, []);
  });

  test('the last section is in twice when the main file holds its text', async () => {
    const { partsTrouble } = await load();

    assert.deepEqual(partsTrouble([MAIN, HARBOUR], { main: MAIN, back: [], recipe: WITH_BACK })?.twice, [{ size: HARBOUR.length, sum: sum16(HARBOUR) }]);
  });

  test('without names each back name the build took out that no later section is, as a whole or as a line', async () => {
    const { partsTrouble } = await load();
    const back = ['text:lamp-notice', 'text:lamp-line'];

    assert.deepEqual(partsTrouble([MAIN, APPENDED], { main: MAIN, back, recipe: WITH_BACK })?.without, back, 'neither came back');
    assert.deepEqual(partsTrouble([MAIN, LAMP_NOTICE, APPENDED], { main: MAIN, back, recipe: WITH_BACK })?.without, ['text:lamp-line'], 'the section came back');
    assert.deepEqual(partsTrouble([MAIN, `Tools of the lamp:\n${LAMP_LINE}`, LAMP_NOTICE, APPENDED], { main: MAIN, back, recipe: WITH_BACK })?.without, [], 'the line came back in a section of its own words');
  });

  test('without counts only the sections after the main file, and only the back names the build took out', async () => {
    const { partsTrouble } = await load();

    // MAIN holds the back line itself, in its tools section: that is not Claude Code adding it.
    assert.deepEqual(partsTrouble([MAIN, APPENDED], { main: MAIN, back: ['text:lamp-line'], recipe: WITH_BACK })?.without, ['text:lamp-line']);
    assert.deepEqual(partsTrouble([MAIN, APPENDED], { main: MAIN, back: [], recipe: WITH_BACK })?.without, [], 'nothing taken out, nothing without');
  });

  test('the answer holds no text of a section: sizes, sums and the recipe\'s names only', async () => {
    const { partsTrouble } = await load();

    const found = partsTrouble([MAIN, FOLDER, TOOLS, APPENDED], { main: MAIN, back: ['text:lamp-notice'], recipe: WITH_BACK });

    const said = JSON.stringify(found);
    assert.ok(found !== undefined, 'the premise: a record of the main file');
    for (const text of [HARBOUR, FOLDER, LAMP_LINE, '- ledger: read the ledger', APPENDED]) assert.ok(!said.includes(text), `the answer holds no section's text, got: ${said}`);
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
  test('holds only drop, units and back, each entry with only its own keys', async () => {
    const recipe = await shippedRecipe();

    assert.deepEqual(Object.keys(recipe).sort(), ['back', 'drop', 'units']);
    assert.ok(Array.isArray(recipe.drop) && Array.isArray(recipe.units) && Array.isArray(recipe.back), `all three are lists, got: ${JSON.stringify(recipe)}`);
    for (const entry of recipe.back) assert.deepEqual(Object.keys(entry).sort(), ['hash', 'models', 'name'], `a back entry is a name, a hash and models, got: ${JSON.stringify(entry)}`);
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
    for (const part of recipe.back ?? []) {
      assert.match(part.name, /^text:[a-z-]+$/, `a back name is text: and a word, got: ${part.name}`);
      assert.match(part.hash, /^[0-9a-f]{64}$/, `${part.name}: a sha256 in hex, got: ${part.hash}`);
      assert.ok(Array.isArray(part.models) && part.models.length > 0, `${part.name}: the models it comes back for, got: ${JSON.stringify(part.models)}`);
      for (const model of part.models) assert.match(model, /^claude-[a-z0-9.-]+$/, `${part.name}: a model id, got: ${model}`);
    }
    const hashes = [...recipe.units.map((unit) => unit.hash), ...recipe.drop.map((one) => one.hash), ...(recipe.back ?? []).map((part) => part.hash)];
    assert.equal(new Set(hashes).size, hashes.length, 'no hash twice');
    for (const text of stringsIn(recipe)) {
      assert.ok(!/\s/.test(text), `no string holds a space, so none is a phrase, got: ${JSON.stringify(text)}`);
      assert.ok(text.length <= 64, `no long string, got: ${JSON.stringify(text)}`);
    }
  });

  test('names at least one part that comes back, each name once and none a name of a unit', async () => {
    const recipe = await shippedRecipe();

    assert.ok(Array.isArray(recipe.back) && recipe.back.length > 0, `the recipe names the parts that Claude Code adds by itself (#784), got: ${JSON.stringify(Object.keys(recipe))}`);
    const names = recipe.back.map((part) => part.name);
    assert.equal(new Set(names).size, names.length, 'each back name once');
    const units = new Set(recipe.units.map((unit) => unit.name));
    assert.deepEqual(names.filter((name) => units.has(name)), [], 'no back name is a unit\'s name');
  });
});
