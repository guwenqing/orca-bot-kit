// The live probe test/system/claude-added-parts-live.test.js prints, beside
// the sha256 sum of each section of Claude Code's main text, the names of the
// kit recipe's parts that the section holds. Issue #793: it must name every
// part it finds, the parts in the recipe's `back` list included.
//
// The seam is the test helper test/helpers/recipe-names.js:
//   recipeNamesOf(section, recipe) -> string[]
//   namesText(names) -> string
//
// A part matches when its `hash` is the sha256 hex digest (UTF-8) of the whole
// section, or of any one line of the section split on "\n". Drop entries are
// named drop-1, drop-2, ... by position (1-based); units and back entries by
// their `name`. Names come in recipe order: drop, then units, then back.
//
// Every text here is invented for the test. None of it is Claude Code's text.
//
// Criteria, as numbered in the brief:
//   C1. A back entry that matches gives its name.
//   C2. Drop and units entries match by the same rule, as before.
//   C3. Recipe order: drop, units, back, each list in its own order.
//   C4. A recipe with no `back` key works as before.
//   C5. A section that matches nothing gives an empty list.
//   C6. namesText: "-" for none, else the names joined by "," with no space.
//
// The tests of C2, C4, C5 and C6 describe what the helper already did at
// commit 683c708; they passed there, so they are descriptions of today's
// behaviour, not guards proven to fail on a change.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { namesText, recipeNamesOf } from './helpers/recipe-names.js';

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const unit = (name, text) => ({ name, hash: sha(text), owner: 'kit', models: ['any'] });
const backPart = (name, text) => ({ name, hash: sha(text), models: ['any'] });

const NOWHERE = sha('a text that no section in this file holds');

test('C1: a section with a line of a back entry gets that entry\'s name', () => {
  const recipe = {
    drop: [{ hash: NOWHERE }],
    units: [unit('text:lanterns', 'Keep the lanterns lit after dusk.')],
    back: [backPart('text:web-search', 'Ask the ferryman before you cross.')],
  };
  const section = 'The harbour opens at noon.\nAsk the ferryman before you cross.\nBring a coat.';

  assert.deepEqual(recipeNamesOf(section, recipe), ['text:web-search']);
});

test('C1: a section whose whole text is a back entry gets that entry\'s name', () => {
  const whole = 'Gulls circle the pier.\nThe tide turns at four.';
  const recipe = {
    drop: [],
    units: [],
    back: [backPart('text:tides', whole)],
  };
  // No single line of the section has the hash; only the whole text does.
  assert.notEqual(sha('Gulls circle the pier.'), sha(whole));
  assert.notEqual(sha('The tide turns at four.'), sha(whole));

  assert.deepEqual(recipeNamesOf(whole, recipe), ['text:tides']);
});

test('C1: the second back entry is found, and the first, which does not match, is not named', () => {
  const recipe = {
    drop: [],
    units: [],
    back: [
      backPart('text:bells', 'Ring the bell twice at the gate.'),
      backPart('text:maps', 'Fold the map along the old creases.'),
    ],
  };
  const section = 'Open the trunk.\nFold the map along the old creases.';

  assert.deepEqual(recipeNamesOf(section, recipe), ['text:maps']);
});

test('C2: only the one matching line of a multi-line section names a unit', () => {
  const recipe = {
    drop: [],
    units: [
      unit('text:orchard', 'Pick the pears before the frost.'),
      unit('text:cellar', 'Seal the cellar door in spring.'),
    ],
  };
  const section = 'Walk the fence line.\nPick the pears before the frost.\nFeed the hens.';

  assert.deepEqual(recipeNamesOf(section, recipe), ['text:orchard']);
});

test('C2: a whole section matches a unit when no single line does', () => {
  const whole = 'First paint the shed.\nThen oil the hinges.';
  const recipe = { drop: [], units: [unit('text:shed', whole)] };

  assert.deepEqual(recipeNamesOf(whole, recipe), ['text:shed']);
});

test('C2: drop entries are named by their 1-based position in drop', () => {
  const recipe = {
    drop: [
      { hash: sha('The first drop text, not in the section.') },
      { hash: sha('Tie the boat to the second post.') },
      { hash: sha('Count the oars in the third shed.') },
    ],
    units: [],
  };
  const section = 'Tie the boat to the second post.\nSomething else.\nCount the oars in the third shed.';

  assert.deepEqual(recipeNamesOf(section, recipe), ['drop-2', 'drop-3']);
});

test('C2: a part matches a whole line only, not a piece of a line', () => {
  const recipe = {
    drop: [{ hash: sha('Sweep the porch') }],
    units: [unit('text:porch', 'the porch')],
    back: [backPart('text:broom', 'Sweep')],
  };
  const section = 'Sweep the porch every morning.\nWater the ferns.';

  assert.deepEqual(recipeNamesOf(section, recipe), []);
});

test('C3: names come drop first, then units, then back, each in its own order', () => {
  const recipe = {
    drop: [
      { hash: sha('Drop line alpha.') },
      { hash: sha('Drop line beta.') },
    ],
    units: [
      unit('text:unit-one', 'Unit line one.'),
      unit('text:unit-two', 'Unit line two.'),
    ],
    back: [
      backPart('text:back-one', 'Back line one.'),
      backPart('text:back-two', 'Back line two.'),
    ],
  };
  // The lines stand in the section in the reverse of recipe order.
  const section = [
    'Back line two.',
    'Back line one.',
    'Unit line two.',
    'Unit line one.',
    'Drop line beta.',
    'Drop line alpha.',
  ].join('\n');

  assert.deepEqual(recipeNamesOf(section, recipe), [
    'drop-1',
    'drop-2',
    'text:unit-one',
    'text:unit-two',
    'text:back-one',
    'text:back-two',
  ]);
});

test('C4: a recipe with no back key still names drop and units parts', () => {
  const recipe = {
    drop: [{ hash: NOWHERE }, { hash: sha('Close the shutters at night.') }],
    units: [unit('text:kettle', 'Fill the kettle from the well.')],
  };
  assert.equal('back' in recipe, false);
  const section = 'Fill the kettle from the well.\nClose the shutters at night.';

  assert.deepEqual(recipeNamesOf(section, recipe), ['drop-2', 'text:kettle']);
});

test('C4: an empty back list names drop and units parts as before', () => {
  const recipe = {
    drop: [{ hash: sha('Close the shutters at night.') }],
    units: [unit('text:kettle', 'Fill the kettle from the well.')],
    back: [],
  };
  const section = 'Close the shutters at night.\nFill the kettle from the well.';

  assert.deepEqual(recipeNamesOf(section, recipe), ['drop-1', 'text:kettle']);
});

test('C5: a section that matches no part gives an empty list', () => {
  const recipe = {
    drop: [{ hash: sha('Close the shutters at night.') }],
    units: [unit('text:kettle', 'Fill the kettle from the well.')],
    back: [backPart('text:web-search', 'Ask the ferryman before you cross.')],
  };
  const section = 'Nothing here is in the recipe.\nNor is this line.';

  assert.deepEqual(recipeNamesOf(section, recipe), []);
  // The same recipe does name a part for a section that holds one.
  assert.deepEqual(recipeNamesOf('Fill the kettle from the well.', recipe), ['text:kettle']);
});

test('C6: namesText gives "-" for no names', () => {
  assert.equal(namesText([]), '-');
});

test('C6: namesText joins names with a comma and no space', () => {
  assert.equal(namesText(['text:web-search']), 'text:web-search');
  assert.equal(namesText(['drop-2', 'text:kettle', 'text:web-search']), 'drop-2,text:kettle,text:web-search');
});
