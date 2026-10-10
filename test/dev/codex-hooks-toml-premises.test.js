// The premises of codex-hooks-only-the-kits.test.js (#506) that need a TOML
// reader: that the config.toml text its tests write is, to a TOML reader, the
// trust they say it is. The reader is smol-toml, a dev dependency.
//
// These tests live under test/dev/ because the release's floor job installs
// only what a user installs, `npm ci --omit=dev`, and runs test/*.test.js
// alone (#533). Pull requests and the release's test job run test/dev/ too,
// where the dev dependencies are installed.

import assert from 'node:assert/strict';
import test from 'node:test';

import { parse as parseToml } from 'smol-toml';

import {
  ESCAPED_OTHER_FORMS,
  escapedTomlString,
  escapedTrustTablesFor,
  hookStateFlag,
  literalTrustTablesFor,
  stateKey,
  trustedHash,
  trustTablesFor,
} from '../helpers/codex-hooks.js';

test('K0 the premise: a TOML reader reads a key written with Unicode escapes as the same key, in every form the tests write', () => {
  const entry = {
    key: stateKey('/private/var/folders/x/T/obk-506/bots/bots/coder/.codex/hooks.json', 'SessionStart', 0, 0),
    hash: trustedHash({ event: 'SessionStart', command: 'obk session record', timeout: 10 }),
  };
  const plain = parseToml(trustTablesFor([entry]));
  const escaped = escapedTomlString(entry.key);
  assert.ok(escaped.includes('\\u002F') && escaped.includes('\\U0000003a'), `both kinds of escape are in it: ${escaped}`);
  assert.ok(!escaped.includes('/') && !escaped.includes(entry.key), `the key's own text is not in it: ${escaped}`);

  assert.deepEqual(parseToml(escapedTrustTablesFor([entry])), plain, 'the usual table form, escaped');
  for (const [form, write] of Object.entries(ESCAPED_OTHER_FORMS)) assert.deepEqual(parseToml(write(entry)), plain, form);
  assert.deepEqual(parseToml(`[hooks.state.${escaped}]\n`), parseToml(`[hooks.state.${JSON.stringify(entry.key)}]\n`), 'a header with no trusted_hash, escaped');
});

test('K0 the premise: the -c value the K7 tests give a session reads, as TOML, as the same trust as the usual table', () => {
  const entry = {
    key: stateKey('/private/var/folders/x/T/obk-506/bots/bots/coder/.codex/hooks.json', 'SessionStart', 0, 0),
    hash: trustedHash({ event: 'SessionStart', command: 'obk session record', timeout: 10 }),
  };
  assert.deepEqual(parseToml(hookStateFlag(entry)), parseToml(trustTablesFor([entry])));
});

test('K0 the premise: a literal-string table [hooks.state.\'<key>\'] gives the same key and hash as the basic-string one, a backslash in the key included', () => {
  const entries = ['/b/bots\\trust/bots/coder/.codex/hooks.json', '/b/bots/bots/coder/.codex/hooks.json'].map((file) => ({
    key: stateKey(file, 'PostToolUse', 0, 0),
    hash: trustedHash({ event: 'PostToolUse', matcher: 'Bash', command: 'obk session nudge', timeout: 10 }),
  }));
  assert.ok(entries[0].key.includes('\\t'), `the premise: the key holds a backslash and a t: ${entries[0].key}`);
  assert.deepEqual(parseToml(literalTrustTablesFor(entries)), parseToml(trustTablesFor(entries)));
});
