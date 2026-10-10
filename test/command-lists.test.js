// Every command the CLI knows is on exactly one of two named lists (#527, the
// architect's ruling).
//
// The default set is written from an explicit list of allowed commands, not
// as "every command but the kept-back ones", so a new command forces a
// choice. `src/commands.js` exports `COMMANDS`, the CLI's command table, keyed
// by the command's words ('temp make'), which the CLI reads to parse a command
// line; `DEFAULT_COMMANDS`, the commands every bot is allowed; and `KEPT_BACK`,
// the commands that keep the user's yes. Every key of COMMANDS is on exactly
// one of the two lists, and neither list names a command COMMANDS lacks. The
// two lists are the requirement's, as test/helpers/permissions.js spells them.
//
// The module is imported whole, so a missing export is an assertion here
// rather than a file that fails to load.

import assert from 'node:assert/strict';
import test from 'node:test';

import * as commands from '../src/commands.js';
import { KIT_COMMANDS, NOT_DEFAULT_COMMANDS } from './helpers/permissions.js';

/** The three exports, each checked for its shape first. */
function lists() {
  const { COMMANDS, DEFAULT_COMMANDS, KEPT_BACK } = commands;
  assert.ok(COMMANDS !== null && typeof COMMANDS === 'object' && !Array.isArray(COMMANDS), `src/commands.js should export COMMANDS, an object keyed by command, got: ${JSON.stringify(COMMANDS)}`);
  assert.ok(Array.isArray(DEFAULT_COMMANDS), `src/commands.js should export DEFAULT_COMMANDS, an array, got: ${JSON.stringify(DEFAULT_COMMANDS)}`);
  assert.ok(Array.isArray(KEPT_BACK), `src/commands.js should export KEPT_BACK, an array, got: ${JSON.stringify(KEPT_BACK)}`);
  return { known: Object.keys(COMMANDS), DEFAULT_COMMANDS, KEPT_BACK };
}

const sorted = (list) => [...list].sort();

test('CL1 every command the CLI knows is on exactly one of the two lists', () => {
  const { known, DEFAULT_COMMANDS, KEPT_BACK } = lists();

  const nowhere = known.filter((command) => !DEFAULT_COMMANDS.includes(command) && !KEPT_BACK.includes(command));
  const both = known.filter((command) => DEFAULT_COMMANDS.includes(command) && KEPT_BACK.includes(command));
  assert.deepEqual(nowhere, [], 'a command on neither list: put it on DEFAULT_COMMANDS or KEPT_BACK');
  assert.deepEqual(both, [], 'a command on both lists');
});

test('CL2 neither list names a command the CLI does not know, and neither names one twice', () => {
  const { known, DEFAULT_COMMANDS, KEPT_BACK } = lists();

  assert.deepEqual(DEFAULT_COMMANDS.filter((command) => !known.includes(command)), [], 'DEFAULT_COMMANDS names a command COMMANDS lacks');
  assert.deepEqual(KEPT_BACK.filter((command) => !known.includes(command)), [], 'KEPT_BACK names a command COMMANDS lacks');
  assert.equal(new Set(DEFAULT_COMMANDS).size, DEFAULT_COMMANDS.length, 'DEFAULT_COMMANDS names a command twice');
  assert.equal(new Set(KEPT_BACK).size, KEPT_BACK.length, 'KEPT_BACK names a command twice');
});

test('CL3 the two lists are the requirement\'s: the default set\'s 34 commands, and the six kept back', () => {
  const { DEFAULT_COMMANDS, KEPT_BACK } = lists();

  assert.deepEqual(sorted(DEFAULT_COMMANDS), sorted(KIT_COMMANDS));
  assert.deepEqual(sorted(KEPT_BACK), sorted(NOT_DEFAULT_COMMANDS));
});
