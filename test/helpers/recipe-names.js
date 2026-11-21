// The kit's recipe's names for a section of Claude Code's main text, for what
// test/system/claude-added-parts-live.test.js prints beside each sum (#784,
// #793). It is here, and not in that file, so a unit test can load it: loading
// a system test runs it against the real Orca. It holds no text of Claude
// Code, and gives only the recipe's own names.

import { unitHash } from '../../src/main-text.js';

/** The recipe's names for a section: those of each drop, unit or back hash that matches the whole section or one of its lines. */
export function recipeNamesOf(section, recipe) {
  const held = new Set([unitHash(section), ...section.split('\n').map(unitHash)]);
  return [
    ...recipe.drop.map((one, at) => ({ name: `drop-${at + 1}`, hash: one.hash })),
    ...recipe.units,
    ...(recipe.back ?? []),
  ].filter((unit) => held.has(unit.hash)).map((unit) => unit.name);
}

/** The recipe's names for a printed line: the names, or `-` for none. */
export const namesText = (names) => (names.length === 0 ? '-' : names.join(','));
