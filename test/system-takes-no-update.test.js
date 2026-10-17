// A person who attends a live run takes no harness update for the machine
// (#618). Taking Codex's or Claude Code's update offer updates that harness for
// the whole machine, not for the run. #581 decided a live test takes none:
// every Codex session a system test makes starts with
// `-c check_for_update_on_startup=false`, so Codex shows no offer. So no system
// test's header or message may tell the person to accept one.
//
// This reads the system tests as text; it runs none of them. It reads comments
// and code both, since a failure message speaks to the person too. Each file is
// read as one run of words: the comment marks at the start of each line are
// taken out and the lines joined, so an instruction wrapped over two comment
// lines is still one sentence. It looks for an instruction to accept, not for
// words: "If Codex offers an update, accept it", "Accept an update offer",
// "answer `1`, Update now". What says the opposite passes: "Never Update now",
// "dismissed with Esc, never taken", "do not accept it", and the code that only
// detects an offer on the screen, such as /Update available!/.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot, snapshot } from './helpers/cli.js';

const systemTestsDir = path.join(repoRoot, 'test', 'system');

/** The verbs that take an offer. */
const TAKE = String.raw`(?:accept|take|answer\s+(?:yes|\x60?1\x60?)|say\s+yes|choose|pick|select|press\s+\x60?1\x60?)`;

/**
 * The shapes of an instruction to take a harness update, each kept inside one
 * sentence: a conditional ("if Codex offers an update, accept it"), a choice
 * of "Update now" on the offer's menu ("answer `1`, Update now"), and a direct
 * one ("accept an update offer"). Where two shapes find the same place, the
 * first one names it.
 */
const INSTRUCTIONS = [
  new RegExp(String.raw`\b(?:if|when)\b[^.]{0,80}?\b(?:offers?\s+(?:an?\s+)?update|update\s+offer|update\s+available)\b[^.,:;]{0,40}?[,:;]\s*${TAKE}\b`, 'gi'),
  new RegExp(String.raw`\b${TAKE}\b[^.]{0,30}?\bUpdate\s+now\b`, 'gi'),
  new RegExp(String.raw`\b${TAKE}\s+(?:(?:the|an?|any|its)\s+)?(?:(?:harness|codex|claude\s+code)(?:'s)?\s+)?update(?:\s+offer)?\b`, 'gi'),
];

/** Words just before an instruction that turn it into its opposite. */
const NEGATED = /(?:\b(?:never|not|no|nor|without)|n't)\s+$/i;

/**
 * Each place in the source that tells the person to take a harness update, as
 * `line N: <the words>` (or `lines N-M` when it wraps), in the order of the
 * source, one entry for each place.
 */
function updateTakenIn(source) {
  const lines = source.split('\n');
  let joined = '';
  const lineAt = [];
  lines.forEach((raw, index) => {
    const text = raw.trim().replace(/^(?:\/\/+|\/\*+|\*\/|\*)\s?/, '').trim();
    const start = joined.length;
    joined += `${text} `;
    for (let at = start; at < joined.length; at += 1) lineAt[at] = index + 1;
  });

  const found = new Map();
  for (const shape of INSTRUCTIONS) {
    for (const match of joined.matchAll(shape)) {
      const before = joined.slice(Math.max(0, match.index - 20), match.index);
      if (NEGATED.test(before)) continue;
      const first = lineAt[match.index];
      const last = lineAt[match.index + match[0].length - 1];
      const where = first === last ? `line ${first}` : `lines ${first}-${last}`;
      if (![...found.keys()].some((key) => key[0] <= last && key[1] >= first)) {
        found.set([first, last], `${where}: ${match[0].replace(/\s+/g, ' ').trim()}`);
      }
    }
  }
  return [...found.entries()].sort(([a], [b]) => a[0] - b[0]).map(([, why]) => why);
}

test('the check names each instruction to take a harness update, and passes the lines that say the opposite', () => {
  const taken = [
    '//   3. Any tab, if its harness offers an update: accept it (PRD 6.5).',
    '//   2. The same tab, if Claude Code offers an update: accept it (PRD 6.5).',
    '// do not answer it (the test fails, which is the finding). If Codex offers an',
    '// update, accept it (PRD 6.5).',
    '//      review: both are given at launch (#240). If Codex offers an update,',
    '//      accept it: `1`, "Update now" (the owner\'s standing decision, #69).',
    "    firstRun: (title) => ` Accept an update offer (1) in ${title}.`,",
    '// If a harness shows an update offer, answer yes.',
    '//   4. Codex\'s update offer: choose Update now.',
  ].join('\n');
  assert.deepEqual(updateTakenIn(taken), [
    'line 1: if its harness offers an update: accept',
    'line 2: if Claude Code offers an update: accept',
    'lines 3-4: If Codex offers an update, accept',
    'lines 5-6: If Codex offers an update, accept',
    'line 7: Accept an update offer',
    'line 8: If a harness shows an update offer, answer yes',
    'line 9: choose Update now',
  ]);

  const opposite = [
    '        // Never Update now: it would update this machine\'s Codex.',
    '// runner\'s KNOWN_WRITERS and needs not be. A Codex update offer is dismissed',
    '// with Esc, never taken. Any other screen in a made session\'s tab stops the',
    '// If Codex offers an update, do not accept it: press Esc.',
    '// If Codex offers an update, never take it.',
    '// Since #581 a live test takes no update, and the person accepts no update offer.',
    '// Do not accept an update offer: it updates the machine\'s Codex.',
    '// Don\'t take the update: press Esc.',
    '// ~/.codex/config.toml; it may still offer an update, which is the person\'s.',
    "    ownQuestion: (rows) => rows.some((row) => /Trust this folder\\?|Hooks need review|Update available!/.test(row)),",
    "  update: { name: 'update offer', choices: /\\bUpdate now\\b/ },",
    '// "Update now", and Codex updated the machine. Orca did not report that screen:',
    "const CODEX_EXTRA = ['-c', 'check_for_update_on_startup=false'];",
  ].join('\n');
  assert.deepEqual(updateTakenIn(opposite), []);
});

// ------------------------------------------------------------- the system tests

test('no system test tells the person who attends it to take a harness update (#581, #618)', async () => {
  const tree = await snapshot(systemTestsDir);
  const files = Object.keys(tree).filter((rel) => tree[rel].startsWith('file:') && rel.endsWith('.js')).sort();
  assert.ok(files.length > 0, 'there should be system tests to check');

  const found = [];
  for (const rel of files) {
    const source = await readFile(path.join(systemTestsDir, rel), 'utf8');
    for (const why of updateTakenIn(source)) found.push(`test/system/${rel}, ${why}`);
  }
  assert.deepEqual(found, [], `System tests that tell the person to take a harness update for the machine (#581):\n  ${found.join('\n  ')}`);
});
