// The check a system test runs before it answers Claude Code's folder trust in
// a throwaway tab of its own (helpers/screens.js `plainTrustOf`; the rulings on
// #238 after #450, and on #451). Read on the screen as captured
// (helpers/screens.js CLAUDE_TRUST, Claude Code 2.1.283) and on that screen
// changed one way at a time.

import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultRules } from '../src/permissions.js';
import { CLAUDE_TRUST, claudeTrustOf, onlyKitTrustOf, onlyPlainTrustOf, plainTrustOf } from './helpers/screens.js';

/** The folder the captured screen names, as the capture spells it. */
const FOLDER = '<tmp>/obk-system-question-Xygmnk/bots/bot-father';

/** The captured screen with each row `change` gives back. */
const changed = (change) => CLAUDE_TRUST.map(change);

test('the plain folder trust for the test\'s own folder may be answered', () => {
  assert.equal(plainTrustOf(CLAUDE_TRUST, FOLDER), undefined);
});

test('the same folder in the other spelling of a macOS temp path is the same folder', () => {
  const real = '/private/var/folders/x/T/obk-system-q/bots/bot-father';
  const shown = changed((row) => (row.trim() === FOLDER ? ' /var/folders/x/T/obk-system-q/bots/bot-father' : row));
  assert.equal(plainTrustOf(shown, real), undefined, 'the screen shows /var, the test knows /private/var');
  assert.equal(plainTrustOf(shown, '/var/folders/x/T/obk-system-q/bots/bot-father'), undefined, 'and the other way round');
});

test('a screen that names a pre-approved permission is not the plain one', () => {
  const shown = [
    ...CLAUDE_TRUST.slice(0, -4),
    ' ⚠ This folder pre-approves 1 tool permission in .claude/settings.json:',
    '   Bash(/opt/kit/src/cli.js temp trust-hooks:*)',
    ...CLAUDE_TRUST.slice(-4),
  ];
  assert.match(String(plainTrustOf(shown, FOLDER)), /pre-approved/);
});

test('a screen that names another folder is not this test\'s to answer', () => {
  assert.match(String(plainTrustOf(CLAUDE_TRUST, '<tmp>/obk-system-other/bots/bot-father')), /does not show this test's folder/);
});

test('a pointer that is not on "No, exit" is not answered: down and return would then mean something else', () => {
  const onYes = changed((row) => {
    if (/No, exit/.test(row)) return '   No, exit';
    if (/Yes, I trust this folder/.test(row)) return ' ❯ Yes, I trust this folder';
    return row;
  });
  assert.match(String(plainTrustOf(onYes, FOLDER)), /pointer is not on "No, exit"/);
});

test('a screen with no "Yes, I trust this folder" choice is not answered', () => {
  const noYes = CLAUDE_TRUST.filter((row) => !/Yes, I trust this folder/.test(row));
  assert.match(String(plainTrustOf(noYes, FOLDER)), /no "Yes, I trust this folder" choice/);
});

// ------------------------------------------- nothing but the plain screen

// send-outside-fleet answers only a screen whose every row from "Accessing
// workspace:" down is a row of the captured plain one, its own folder in the
// folder's place (the ruling on #451, comment 5961132572; review-451 found a
// screen with one more row answered). helpers/screens.js `onlyPlainTrustOf`.

/** The captured screen with `extra` put in after its "execute files here" row. */
const withRow = (extra) => CLAUDE_TRUST.flatMap((row) => (/execute files here/.test(row) ? [row, extra] : [row]));

test('only-plain: the captured plain screen for its own folder may be answered, in either spelling of a macOS temp path', () => {
  assert.equal(onlyPlainTrustOf(CLAUDE_TRUST, FOLDER), undefined, 'the screen as captured');
  const shown = changed((row) => (row.trim() === FOLDER ? ' /var/folders/x/T/obk-system-q/bots/receiver' : row));
  assert.equal(onlyPlainTrustOf(shown, '/private/var/folders/x/T/obk-system-q/bots/receiver'), undefined, 'the screen shows /var, the test knows /private/var');
  assert.equal(onlyPlainTrustOf(changed((row) => (row.trim() === FOLDER ? ' /private/var/folders/x/T/q/bots/receiver' : row)), '/var/folders/x/T/q/bots/receiver'), undefined, 'and the other way round');
});

for (const [label, extra] of [
  ['the reviewer\'s network permissions row', ' This folder will enable additional network permissions.'],
  ['a row about hooks', ' This folder has hooks that will run when Claude Code starts.'],
  ['a ⚠ row', ' ⚠ Something about this folder.'],
]) {
  test(`only-plain: a screen with one more row, ${label}, is refused, naming the row`, () => {
    const said = onlyPlainTrustOf(withRow(extra), FOLDER);
    assert.equal(typeof said, 'string', `refused: ${said}`);
    assert.ok(said.includes(extra.trim()), `and the refusal names the row it has no ruling for: ${said}`);
  });
}

test('only-plain: a screen that names another folder is refused', () => {
  const said = onlyPlainTrustOf(CLAUDE_TRUST, '<tmp>/obk-system-other/bots/receiver');
  assert.equal(typeof said, 'string', `refused: ${said}`);
  assert.ok(said.includes(FOLDER), `naming the folder row it shows instead: ${said}`);
});

test('only-plain: a screen whose pointer is on "Yes" is refused', () => {
  const onYes = changed((row) => {
    if (/No, exit/.test(row)) return '   No, exit';
    if (/Yes, I trust this folder/.test(row)) return ' ❯ Yes, I trust this folder';
    return row;
  });
  assert.equal(typeof onlyPlainTrustOf(onYes, FOLDER), 'string');
});

test('only-plain: rows above "Accessing workspace:" are the tab\'s own and not judged; a screen without that row is refused', () => {
  const above = ['$ something the shell printed before', ...CLAUDE_TRUST];
  assert.equal(onlyPlainTrustOf(above, FOLDER), undefined, 'a launch line above the screen is not part of it');
  const without = CLAUDE_TRUST.filter((row) => !/Accessing workspace:/.test(row));
  assert.equal(typeof onlyPlainTrustOf(without, FOLDER), 'string', 'no "Accessing workspace:", so not the screen this was captured as');
});

test('only-plain: blank rows between the screen\'s rows are not judged, as Orca\'s rendered rows have them', () => {
  const spaced = CLAUDE_TRUST.flatMap((row) => [row, '', '   ']);
  assert.equal(onlyPlainTrustOf(spaced, FOLDER), undefined);
});

test('only-plain: a screen missing one of the plain screen\'s needed rows is refused: the "Yes" choice, the folder', () => {
  assert.equal(typeof onlyPlainTrustOf(CLAUDE_TRUST.filter((row) => !/Yes, I trust this folder/.test(row)), FOLDER), 'string', 'no "Yes" choice');
  assert.equal(typeof onlyPlainTrustOf(CLAUDE_TRUST.filter((row) => row.trim() !== FOLDER), FOLDER), 'string', 'no folder shown');
});

// ------------------------------------- the screen that lists the kit's rules

// Since #539 the kit writes its default allow rules into each Claude bot's
// .claude/settings.json, and Claude Code's folder trust then says it
// "pre-approves" them. Every system test answers that screen only through
// helpers/screens.js `claudeTrustOf` (#558; the ruling on #555, comment
// 6104732453, and its follow-up): only for the kit's own default set, as the
// tab's own settings hold it, and only on the screen pinned below.

/** The throwaway bots folder of the #555 live run (kit-dev work/developer-555/trust-screen-555.txt). */
const KIT_BOTS = '/private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-interrupt-AEWWHT';

/** The CLI that run's kit called itself back with, as its launch line shows. */
const KIT_CLI = '/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/developer-555/repo/src/cli.js';

/** The bot folder its tab opened in, the folder the screen names. */
const KIT_FOLDER = `${KIT_BOTS}/bots/mail-claude`;

/** The same folder in the other spelling of a macOS temp path. */
const KIT_FOLDER_VAR = KIT_FOLDER.replace(/^\/private/, '');

/** The kit's default rules for that bots folder: what the tab's settings should allow, nothing more. */
const DEFAULTS = defaultRules(KIT_BOTS, KIT_CLI);

/**
 * Claude Code's folder trust as the #555 live run showed it, from its rule row
 * down to its foot row, pinned as the runner printed it with the runner's
 * indent of six spaces taken off and nothing else changed.
 */
const KIT_SCREEN = [
  '─'.repeat(120),
  ' Accessing workspace:',
  ' /private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-interrupt-AEWWHT/bots/mail-claude',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
  ' project, or work from your team). If not, take a moment to review what\'s in this folder first.',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  ' ⚠ This folder pre-approves 36 tool permissions in .claude/settings.json:',
  '   Bash(/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/d…, Bash(git add:*), Bash(git commit:*), Bash(orca',
  ' orchestration check --run:*), and Read(//private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn…',
  ' These will apply without asking. Only proceed if you trust this configuration.',
  ' Security guide',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  ' Enter to confirm · Esc to cancel',
];

/** The rows the runner printed above the screen: the tab's launch line and the mailbox step's answer. */
const KIT_LAUNCH = [
  '➜  mail-claude git:(main) ✗ /Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/developer-555/repo/src/cli.js session',
  'mailbox --bots /private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-interrupt-AEWWHT --bot mail-claude --',
  'session idle; OBK_TAB_SHELL=$$ OBK_CLI=/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/developer-555/repo/src/cli.',
  'js claude --permission-mode auto -n mail-claude.idle.abqu3q1i -- "$(cat /private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm',
  '0000gn/T/obk-system-interrupt-AEWWHT.prompts/mail-claude/idle.txt)"',
  'mail-claude/idle has its mailbox run_771a9bd46621, made in this tab.',
];

/** The warning row as the pinned screen has it, for the 36 rules the #555 run's kit gave. */
const WARN_CAPTURED = ' ⚠ This folder pre-approves 36 tool permissions in .claude/settings.json:';

/** The same row for the kit's default set as it is now. */
const WARN = ` ⚠ This folder pre-approves ${DEFAULTS.length} tool permissions in .claude/settings.json:`;

/** The two rule rows of the pinned screen, as captured: the fourth item is the bare orca check. */
const LIST_1_CAPTURED = '   Bash(/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/d…, Bash(git add:*), Bash(git commit:*), Bash(orca';
const LIST_2_CAPTURED = ' orchestration check --run:*), and Read(//private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn…';

/** The rule the pinned screen lists that #564 R1 took out of the default set. */
const ORCA_CHECK = 'Bash(orca orchestration check --run:*)';

/**
 * The pinned screen is a capture of the set the #555 run's kit gave: 36 rules,
 * among them the bare orca check, which the screen lists. #564 R1 takes that
 * rule out of the set (35 rules), and #615 R1 takes out the rules of bot
 * change, session add and session change (32 rules), so the capture as it
 * stands is now a screen for a set the kit no longer writes, and the check
 * must refuse it (the tests below hold that). The three #615 took out are not
 * among the rules the screen lists by name.
 *
 * KIT_NOW is not a capture. It is derived from the capture by hand, to test the
 * check's other rules on a screen for the set as it is now: the count row for
 * the set now, the bare orca check taken out of the rule rows (the ", and"
 * before the last item kept), every other row as captured. How Claude Code
 * lists and wraps the rules of a 32-rule set has not been seen live; a live
 * run that brings the screen up is what shows that.
 */
const LIST_1 = '   Bash(/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/d…, Bash(git add:*), Bash(git commit:*), and';
const LIST_2 = ' Read(//private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn…';
const KIT_NOW = KIT_SCREEN.map((row) => {
  if (row === WARN_CAPTURED) return WARN;
  if (row === LIST_1_CAPTURED) return LIST_1;
  if (row === LIST_2_CAPTURED) return LIST_2;
  return row;
});
const APPLY = ' These will apply without asking. Only proceed if you trust this configuration.';
const GUIDE = ' Security guide';

/** The pinned screen with the row `from` changed to `to` (or taken out, for `to` undefined). */
const swap = (from, to) => {
  assert.ok(KIT_NOW.includes(from), `the pinned screen has the row ${from}`);
  return KIT_NOW.flatMap((row) => (row === from ? (to === undefined ? [] : [to]) : [row]));
};

/** The pinned screen with `extra` put in right after the row `after`. */
const withRowAfter = (after, extra) => {
  assert.ok(KIT_NOW.includes(after), `the pinned screen has the row ${after}`);
  return KIT_NOW.flatMap((row) => (row === after ? [row, extra] : [row]));
};

/** The settings the tab should hold: its allow list is the kit's default set. */
const KIT = { allow: DEFAULTS, defaults: DEFAULTS };

/** Asserts `said` is a refusal, and that it names each of `seen`. */
const refused = (said, ...seen) => {
  assert.equal(typeof said, 'string', `refused, not answered: ${said}`);
  for (const what of seen) assert.ok(said.includes(what), `the refusal names ${what}: ${said}`);
};

test('kit trust: the kit\'s default set for the captured paths has 32 rules, the 36 the screen counted less the bare orca check (#564 R1) and the rules of bot change, session add and session change (#615 R1), all different (a change to the defaults shows here first)', () => {
  const removed = ['session nudge', 'session mail'].map((command) => `Bash(${KIT_CLI} ${command} --bots ${KIT_BOTS}:*)`);
  for (const rule of removed) assert.ok(!DEFAULTS.includes(rule), `${rule} is no longer a default (#555)`);
  assert.ok(!DEFAULTS.includes(ORCA_CHECK), `${ORCA_CHECK} is no longer a default (#564 R1)`);
  const kept = ['bot change', 'session add', 'session change'].map((command) => `Bash(${KIT_CLI} ${command} --bots ${KIT_BOTS}:*)`);
  for (const rule of kept) assert.ok(!DEFAULTS.includes(rule), `${rule} is no longer a default (#615 R1)`);
  assert.equal(DEFAULTS.length, 32, 'the 36 the screen counted, less four');
  assert.equal(new Set(DEFAULTS).size, DEFAULTS.length);
  assert.ok(DEFAULTS.includes('Bash(git add:*)') && DEFAULTS.includes('Bash(git commit:*)'), 'the other whole rules the screen lists are in the set');
});

test('kit trust (#564 R1): the pinned screen as captured, its count 36, is refused for the default set as it is now, naming the count', () => {
  refused(claudeTrustOf(KIT_SCREEN, KIT_FOLDER, KIT), '36');
});

test('kit trust (#564 R1): the pinned screen with only its count row made the set\'s, which still lists the bare orca check, is refused, naming that rule', () => {
  const counted = KIT_SCREEN.map((row) => (row === WARN_CAPTURED ? WARN : row));
  assert.notDeepEqual(counted, KIT_SCREEN, 'the premise: the count row changed');
  refused(claudeTrustOf(counted, KIT_FOLDER, KIT), ORCA_CHECK);
});

test('kit trust: the screen derived for the set as it is now differs from the capture only in its count row and its two rule rows, and is answered', () => {
  const changedRows = KIT_SCREEN.map((row, at) => [row, KIT_NOW[at]]).filter(([was, now]) => was !== now);
  assert.deepEqual(changedRows, [[WARN_CAPTURED, WARN], [LIST_1_CAPTURED, LIST_1], [LIST_2_CAPTURED, LIST_2]]);
  assert.equal(claudeTrustOf(KIT_NOW, KIT_FOLDER, KIT), undefined);
});

test('kit trust: the pinned screen is answered when the tab allows exactly the defaults, in any order', () => {
  assert.equal(claudeTrustOf(KIT_NOW, KIT_FOLDER, KIT), undefined, 'in the kit\'s order');
  assert.equal(claudeTrustOf(KIT_NOW, KIT_FOLDER, { allow: [...DEFAULTS].reverse(), defaults: DEFAULTS }), undefined, 'reversed');
  const mixed = [...DEFAULTS.filter((rule, at) => at % 2 === 1), ...DEFAULTS.filter((rule, at) => at % 2 === 0)];
  assert.equal(claudeTrustOf(KIT_NOW, KIT_FOLDER, { allow: mixed, defaults: DEFAULTS }), undefined, 'mixed');
  assert.equal(onlyKitTrustOf(KIT_NOW, KIT_FOLDER, { allow: mixed, defaults: DEFAULTS }), undefined, 'and by onlyKitTrustOf');
});

test('kit trust: the pinned screen is answered in either spelling of a macOS temp path', () => {
  assert.equal(claudeTrustOf(KIT_NOW, KIT_FOLDER_VAR, KIT), undefined, 'the screen shows /private/var, the test knows /var');
  const shown = swap(` ${KIT_FOLDER}`, ` ${KIT_FOLDER_VAR}`);
  assert.equal(claudeTrustOf(shown, KIT_FOLDER, KIT), undefined, 'and the other way round');
});

test('kit trust: the tab\'s launch line and the mailbox answer above the screen are not judged', () => {
  assert.equal(claudeTrustOf([...KIT_LAUNCH, ...KIT_NOW], KIT_FOLDER, KIT), undefined);
});

test('kit trust: a count one more or one less than the defaults is refused, naming the count it saw', () => {
  for (const count of [DEFAULTS.length + 1, DEFAULTS.length - 1]) {
    const shown = swap(WARN, ` ⚠ This folder pre-approves ${count} tool permissions in .claude/settings.json:`);
    refused(claudeTrustOf(shown, KIT_FOLDER, KIT), String(count));
  }
});

test('kit trust: the right count with one allowed rule that is not a default is refused, naming the rule', () => {
  const allow = [...DEFAULTS.slice(0, -1), 'Bash(rm -rf:*)'];
  assert.equal(allow.length, DEFAULTS.length, 'the count on the screen still fits');
  refused(claudeTrustOf(KIT_NOW, KIT_FOLDER, { allow, defaults: DEFAULTS }), 'Bash(rm -rf:*)');
});

test('kit trust: the right count with one listed rule that is not a default is refused, naming the rule', () => {
  const shown = swap(LIST_1, LIST_1.replace('Bash(git add:*)', 'Bash(rm -rf:*)'));
  refused(claudeTrustOf(shown, KIT_FOLDER, KIT), 'Bash(rm -rf:*)');
});

test('kit trust: a listed rule for another bots folder is refused, whole or cut short', () => {
  const other = `Bash(${KIT_CLI} up --bots /private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-other-ZZZZZZ:*)`;
  assert.ok(!DEFAULTS.includes(other));
  refused(claudeTrustOf(swap(LIST_1, LIST_1.replace('Bash(git commit:*)', other)), KIT_FOLDER, KIT), other);

  const cutRead = 'Read(//private/var/folders/zz/other0000gn…';
  refused(claudeTrustOf(swap(LIST_2, LIST_2.replace('Read(//private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn…', cutRead)), KIT_FOLDER, KIT), cutRead);

  const cutBash = 'Bash(/opt/other-kit/src/cli.js up --bots /private/var/folders/9c/…';
  refused(claudeTrustOf(swap(LIST_1, LIST_1.replace('Bash(/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/d…', cutBash)), KIT_FOLDER, KIT), cutBash);
});

test('kit trust: a listed item that is only the start of a rule, with no "…", is refused', () => {
  const shown = swap(LIST_1, LIST_1.replace('Bash(git add:*)', 'Bash(git add'));
  refused(claudeTrustOf(shown, KIT_FOLDER, KIT), 'Bash(git add');
});

test('kit trust: an extra row is refused, naming the row, wherever it is', () => {
  const extra = ' This folder has hooks that will run when Claude Code starts.';
  for (const after of [' Claude Code\'ll be able to read, edit, and execute files here.', LIST_2, APPLY, GUIDE]) {
    refused(claudeTrustOf(withRowAfter(after, extra), KIT_FOLDER, KIT), extra.trim());
  }
});

test('kit trust: the plain screen is still answered for a folder that allows nothing', () => {
  assert.equal(claudeTrustOf(CLAUDE_TRUST, FOLDER, { allow: [], defaults: DEFAULTS }), undefined);
});

test('kit trust: the plain screen is refused for a folder whose settings allow rules', () => {
  refused(claudeTrustOf(CLAUDE_TRUST, FOLDER, { allow: DEFAULTS, defaults: DEFAULTS }));
  refused(onlyKitTrustOf(CLAUDE_TRUST, FOLDER, { allow: DEFAULTS, defaults: DEFAULTS }), 'pre-approves');
});

test('kit trust: an allow list with more or fewer rules than the defaults is refused', () => {
  refused(claudeTrustOf(KIT_NOW, KIT_FOLDER, { allow: [...DEFAULTS, 'Bash(rm -rf:*)'], defaults: DEFAULTS }), 'Bash(rm -rf:*)');
  refused(claudeTrustOf(KIT_NOW, KIT_FOLDER, { allow: DEFAULTS.slice(1), defaults: DEFAULTS }));
  refused(claudeTrustOf(KIT_NOW, KIT_FOLDER, { allow: DEFAULTS.filter((rule) => rule !== 'Bash(git add:*)'), defaults: DEFAULTS }));
  refused(claudeTrustOf(KIT_NOW, KIT_FOLDER, { allow: [], defaults: DEFAULTS }));
});

test('kit trust: the defaults for another bots folder are not this tab\'s allow list', () => {
  const others = defaultRules('/private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-other-ZZZZZZ', KIT_CLI);
  refused(claudeTrustOf(KIT_NOW, KIT_FOLDER, { allow: others, defaults: DEFAULTS }));
});

test('kit trust: a missing or changed pinned row is refused', () => {
  const cases = [
    ['no warning row', swap(WARN, undefined)],
    ['the warning for another file', swap(WARN, ` ⚠ This folder pre-approves ${DEFAULTS.length} tool permissions in .claude/settings.local.json:`)],
    ['no "These will apply" row', swap(APPLY, undefined)],
    ['a changed "These will apply" row', swap(APPLY, ' These will apply without asking.')],
    ['no "Security guide" row', swap(GUIDE, undefined)],
    ['a changed "Security guide" row', swap(GUIDE, ' Security guide (read this first)')],
    ['the two pinned rows the other way round', KIT_NOW.map((row) => (row === APPLY ? GUIDE : row === GUIDE ? APPLY : row))],
    ['no "Accessing workspace:" row', swap(' Accessing workspace:', undefined)],
    ['a changed safety row', swap(' Claude Code\'ll be able to read, edit, and execute files here.', ' Claude Code\'ll be able to read, edit, execute and delete files here.')],
  ];
  for (const [label, shown] of cases) {
    const said = claudeTrustOf(shown, KIT_FOLDER, KIT);
    assert.equal(typeof said, 'string', `${label}: refused, not answered: ${said}`);
  }
});

test('kit trust: the pinned screen for another folder is refused', () => {
  refused(claudeTrustOf(KIT_NOW, `${KIT_BOTS}/bots/other-bot`, KIT));
  refused(claudeTrustOf(KIT_NOW, '/private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-other-ZZZZZZ/bots/mail-claude', KIT));
});

test('kit trust: the pinned screen with its pointer on "Yes", or with no "Yes" choice, is refused', () => {
  const onYes = KIT_NOW.map((row) => {
    if (row === ' ❯ No, exit') return '   No, exit';
    if (row === '   Yes, I trust this folder') return ' ❯ Yes, I trust this folder';
    return row;
  });
  refused(claudeTrustOf(onYes, KIT_FOLDER, KIT));
  refused(claudeTrustOf(swap('   Yes, I trust this folder', undefined), KIT_FOLDER, KIT));
});

test('kit trust: the plain checks still refuse the pinned screen', () => {
  refused(onlyPlainTrustOf(KIT_NOW, KIT_FOLDER));
  refused(plainTrustOf(KIT_NOW, KIT_FOLDER));
});

test('kit trust: a set of the defaults and one rule of the test\'s own is answered when the caller passes that set, and refused against the defaults alone', () => {
  const own = 'Bash(/usr/bin/true:*)';
  assert.ok(!DEFAULTS.includes(own));
  const set = [...DEFAULTS, own];
  const shown = swap(WARN, ` ⚠ This folder pre-approves ${set.length} tool permissions in .claude/settings.json:`)
    .map((row) => (row === LIST_1 ? LIST_1.replace('Bash(git add:*)', own) : row));
  assert.equal(claudeTrustOf(shown, KIT_FOLDER, { allow: [...set].reverse(), defaults: set }), undefined, 'the bigger set passed as defaults');
  refused(claudeTrustOf(shown, KIT_FOLDER, { allow: [...set].reverse(), defaults: DEFAULTS }), own);
});

// ------------------------------------------------------- the same words, wrapped

// The live run of test/system/memory-write.test.js stopped here, before any
// memory write: Claude Code wraps the same words elsewhere in a wider tab, and
// the compare went row by row against a capture made at 120 columns. Line wrap is
// not part of what the rulings on #451 and #555 ruled, so the compare ignores it,
// and nothing else (the architect's ruling on #722). The screen from "Accessing
// workspace:" to its end is compared whole, as words in order.

/** The throwaway bots folder of that live run. */
const LIVE_BOTS = '/private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-memory-write-I5d4pI';

/** The CLI that run's kit called itself back with, as its launch line shows. */
const LIVE_CLI = '/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/developer-722/orca-bot-kit/src/cli.js';

/** The bot folder its tab opened in, the folder the screen names. */
const LIVE_FOLDER = `${LIVE_BOTS}/bots/memory-write`;

/** The tab's own allow list: the kit's default set for that run's bots folder. */
const LIVE_DEFAULTS = defaultRules(LIVE_BOTS, LIVE_CLI);
const LIVE_KIT = { allow: LIVE_DEFAULTS, defaults: LIVE_DEFAULTS };

/**
 * SEEN LIVE on 2026-11-03, in a tab of about 131 columns, on Claude Code 2.1.317
 * and Orca 1.4.245: the rows the runner printed under "what it showed:", with the
 * runner's indent of six spaces taken off and nothing else changed. The paths are
 * that run's own throwaway folder.
 */
const LIVE_ROWS = [
  '➜  memory-write git:(main) ✗ /Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/developer-722/orca-bot-kit/src/cli.js session ma',
  'ilbox -',
  '-bots /private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-memory-write-I5d4pI --bot memory-write --session daily; O',
  'BK_TAB_',
  'SHELL=$$ OBK_CLI=/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/developer-722/orca-bot-kit/src/cli.js claude --permission-mo',
  'de auto',
  ' -n memory-write.daily.ck2l1jdv --model claude-haiku-5-5 --effort low --settings \'{"autoMemoryDirectory":"/Users/q/.claude/projects',
  '/-priva',
  'te-var-folders-9c-kh9z1-yd1gq9y0x3pm7h79cm0000gn-T-obk-system-memory-write-I5d4pI/memory"}\' -- "$(cat /private/var/folders/9c/kh9z1',
  '_yd1gq9',
  'y0x3pm7h79cm0000gn/T/obk-system-memory-write-I5d4pI.prompts/memory-write/daily.txt)"',
  'memory-write/daily has its mailbox run_7b822b978564, made in this tab.',
  '───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  ' Accessing workspace:',
  ' /private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-memory-write-I5d4pI/bots/memory-write',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or',
  ' work from your team). If not, take a moment to review what\'s in this folder first.',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  ' ⚠ This folder pre-approves 32 tool permissions in .claude/settings.json:',
  '   Bash(/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/d…, Bash(git add:*), Bash(git commit:*), and',
  ' Read(//private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn…',
  ' These will apply without asking. Only proceed if you trust this configuration.',
  ' Security guide',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  ' Enter to confirm · Esc to cancel',
];

const LIVE_TOP = LIVE_ROWS.indexOf(' Accessing workspace:');
const LIVE_WARN = LIVE_ROWS.findIndex((row) => row.includes('pre-approves'));
const LIVE_APPLY = LIVE_ROWS.findIndex((row) => row.startsWith(' These will apply'));

/**
 * The plain screen with the prose wrapped as the live run wrapped it. NOT seen
 * live as a whole: it is the live screen with its warning, rule and "These will
 * apply" rows taken out, every other row as seen.
 */
const WIDE_PLAIN = [...LIVE_ROWS.slice(LIVE_TOP, LIVE_WARN), ...LIVE_ROWS.slice(LIVE_APPLY + 1)];

/**
 * The plain screen in a tab of 80 columns, for the capture's short folder. NOT
 * seen live: the capture's words wrapped by hand at the last space that fits.
 * What wraps here is the prose alone, so the folder and the two choices are rows
 * of their own, as plainTrustOf wants them.
 */
const NARROW_PLAIN = [
  ' Accessing workspace:',
  ` ${FOLDER}`,
  ' Quick safety check: Is this a project you created or one you trust? (Like your',
  ' own code, a well-known open source project, or work from your team). If not,',
  ' take a moment to review what\'s in this folder first.',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  ' Security guide',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  ' Enter to confirm · Esc to cancel',
];

/**
 * The live screen in a tab of 110 columns, narrower than the live one and as
 * narrow as this run's folder lets it stay whole. NOT seen live: the prose wrapped
 * by hand at the last space that fits, the rule rows as seen.
 */
const NARROW_KIT = [
  ' Accessing workspace:',
  ` ${LIVE_FOLDER}`,
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open',
  ' source project, or work from your team). If not, take a moment to review what\'s in this folder first.',
  ...LIVE_ROWS.slice(LIVE_ROWS.indexOf(' Claude Code\'ll be able to read, edit, and execute files here.')),
];

/** The rows from "Accessing workspace:" down, as words, each with its row and its place in that row. */
const placesOf = (rows) => rows.flatMap((row, at) => row.trim().split(' ').map((word, inRow) => ({ at, inRow, word })));

/** `rows` with the word at `place` changed by `change`, which gives back the words to stand in its place. */
const withWord = (rows, { at, inRow }, change) => rows.map((row, here) => {
  if (here !== at) return row;
  const words = row.trim().split(' ');
  return ` ${[...words.slice(0, inRow), ...change(words[inRow]), ...words.slice(inRow + 1)].join(' ')}`;
});

/** The live screen's rule rows, which `onlyKitTrustOf` reads as its list of rules and not as words of the plain screen. */
const LIVE_RULES = LIVE_ROWS.slice(LIVE_WARN + 1, LIVE_APPLY).map((row) => row.trim());

test('wrap: the kit\'s trust screen seen live at about 131 columns is answered, with the kit\'s default rules for that run', () => {
  assert.equal(LIVE_ROWS[LIVE_TOP - 1].length, 131, 'the premise: the rule row across the tab has 131 columns');
  assert.equal(LIVE_DEFAULTS.length, 32, 'the premise: the set is the 32 the screen counts');
  assert.equal(claudeTrustOf(LIVE_ROWS, LIVE_FOLDER, LIVE_KIT), undefined, 'by the one check every system test uses');
  assert.equal(onlyKitTrustOf(LIVE_ROWS, LIVE_FOLDER, LIVE_KIT), undefined, 'and by onlyKitTrustOf');
});

test('wrap: the live screen is answered in the other spelling of the temp path, and is refused for another folder', () => {
  assert.equal(claudeTrustOf(LIVE_ROWS, LIVE_FOLDER.replace(/^\/private/, ''), LIVE_KIT), undefined, 'the screen shows /private/var, the test knows /var');
  refused(claudeTrustOf(LIVE_ROWS, `${LIVE_BOTS}/bots/other-bot`, LIVE_KIT), LIVE_FOLDER);
});

test('wrap: the kit\'s own checks still refuse the live screen: a wrong count, a rule not in the set, a changed foot, an allow list that is not the set', () => {
  const swapped = (from, to) => {
    assert.ok(LIVE_ROWS.includes(from), `the live screen has the row ${from}`);
    return LIVE_ROWS.map((row) => (row === from ? to : row));
  };
  refused(claudeTrustOf(swapped(LIVE_ROWS[LIVE_WARN], ' ⚠ This folder pre-approves 33 tool permissions in .claude/settings.json:'), LIVE_FOLDER, LIVE_KIT), '33');
  const rule = '   Bash(/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/d…, Bash(git add:*), Bash(git commit:*), and';
  refused(claudeTrustOf(swapped(rule, rule.replace('Bash(git add:*)', 'Bash(rm -rf:*)')), LIVE_FOLDER, LIVE_KIT), 'Bash(rm -rf:*)');
  refused(claudeTrustOf(swapped(LIVE_ROWS[LIVE_APPLY], ' These will apply without asking.'), LIVE_FOLDER, LIVE_KIT), 'These will apply');
  refused(claudeTrustOf(swapped(' Security guide', ' Security guide (read this first)'), LIVE_FOLDER, LIVE_KIT), 'Security guide');
  refused(claudeTrustOf(LIVE_ROWS, LIVE_FOLDER, { allow: [...LIVE_DEFAULTS.slice(1), 'Bash(rm -rf:*)'], defaults: LIVE_DEFAULTS }), 'Bash(rm -rf:*)');
});

test('wrap: the plain screen is answered as the capture wrapped it, as the live run wrapped it, and at 80 columns', () => {
  assert.equal(onlyPlainTrustOf(CLAUDE_TRUST, FOLDER), undefined, 'the capture, at 120 columns');
  assert.equal(onlyPlainTrustOf(WIDE_PLAIN, LIVE_FOLDER), undefined, 'the live run\'s prose rows, at about 131 columns');
  for (const row of NARROW_PLAIN) assert.ok(row.length <= 80, `the premise: the row fits 80 columns: ${row}`);
  assert.equal(onlyPlainTrustOf(NARROW_PLAIN, FOLDER), undefined, 'the prose wrapped at 80 columns');
  assert.equal(plainTrustOf(NARROW_PLAIN, FOLDER), undefined, 'plainTrustOf takes it as it stands');
  assert.equal(claudeTrustOf(NARROW_PLAIN, FOLDER, { allow: [], defaults: DEFAULTS }), undefined, 'and so does the one check every system test uses');
});

test('wrap: the kit\'s screen is answered at 110 columns, with this run\'s folder whole on its row', () => {
  for (const row of NARROW_KIT) assert.ok(row.length <= 110, `the premise: the row fits 110 columns: ${row}`);
  assert.equal(claudeTrustOf(NARROW_KIT, LIVE_FOLDER, LIVE_KIT), undefined);
});

// A folder longer than the tab is wide wraps too, and plainTrustOf wants the
// folder as a whole row. It keeps that check (the ruling on #722), so such a
// screen is refused: the run stops, and a person looks. How Claude Code breaks a
// long path has not been seen live, so these rows are the path cut by hand.
test('wrap: a folder row that itself wraps is refused, by the compare and by plainTrustOf', () => {
  const broken = NARROW_KIT.flatMap((row) => (row === ` ${LIVE_FOLDER}`
    ? [` ${LIVE_FOLDER.slice(0, 79)}`, LIVE_FOLDER.slice(79)]
    : [row]));
  refused(claudeTrustOf(broken, LIVE_FOLDER, LIVE_KIT), LIVE_FOLDER.slice(0, 79));
  const plain = NARROW_PLAIN.flatMap((row) => (row === ` ${FOLDER}` ? [` ${FOLDER.slice(0, 20)}`, FOLDER.slice(20)] : [row]));
  refused(onlyPlainTrustOf(plain, FOLDER), FOLDER.slice(0, 20));
  refused(plainTrustOf(plain, FOLDER), 'does not show this test\'s folder');
});

// The kit's foot row is compared as a whole row, as #555 pinned it, so it does not
// take line wrap. It has 79 columns with its indent, so in a narrower tab the
// screen is refused. That stays (the ruling on #722: its own checks stay).
test('wrap: the kit\'s foot row wrapped in a narrower tab is refused, as it was', () => {
  const wrapped = NARROW_KIT.flatMap((row) => (row === LIVE_ROWS[LIVE_APPLY]
    ? [' These will apply without asking. Only proceed if you trust this', ' configuration.']
    : [row]));
  refused(claudeTrustOf(wrapped, LIVE_FOLDER, LIVE_KIT), 'These will apply');
});

for (const [name, rows, folder] of [
  ['the capture', CLAUDE_TRUST.slice(CLAUDE_TRUST.findIndex((row) => row.includes('Accessing workspace:'))), FOLDER],
  ['the live run\'s wrapping', WIDE_PLAIN, LIVE_FOLDER],
  ['the wrapping at 80 columns', NARROW_PLAIN, FOLDER],
]) {
  test(`wrap: in ${name}, every word changed, removed or doubled, and every two neighbours swapped, is refused`, () => {
    assert.equal(onlyPlainTrustOf(rows, folder), undefined, 'the premise: as it stands, it is answered');
    const places = placesOf(rows);
    for (const place of places) {
      const label = `row ${place.at}, word ${place.inRow}, "${place.word}"`;
      assert.equal(typeof onlyPlainTrustOf(withWord(rows, place, (word) => [`${word}x`]), folder), 'string', `changed at the end: ${label}`);
      assert.equal(typeof onlyPlainTrustOf(withWord(rows, place, (word) => [`x${word}`]), folder), 'string', `changed at the start: ${label}`);
      assert.equal(typeof onlyPlainTrustOf(withWord(rows, place, () => []), folder), 'string', `removed: ${label}`);
      assert.equal(typeof onlyPlainTrustOf(withWord(rows, place, (word) => [word, word]), folder), 'string', `doubled: ${label}`);
    }
    for (const [at, place] of places.entries()) {
      const next = places[at + 1];
      if (next === undefined || next.word === place.word) continue;
      const swappedWords = rows.map((row, here) => {
        const words = row.trim().split(' ');
        if (here === place.at) words[place.inRow] = next.word;
        if (here === next.at) words[next.inRow] = place.word;
        return ` ${words.join(' ')}`;
      });
      assert.equal(typeof onlyPlainTrustOf(swappedWords, folder), 'string', `swapped: "${place.word}" and "${next.word}", across a row boundary or not`);
    }
  });

  test(`wrap: in ${name}, an added row is refused at every place, the last included, new words or words already there`, () => {
    const repeats = [...rows.map((row) => row.trim()), 'cancel', 'Security guide', 'this', ' '.repeat(3) + rows.at(-1).trim()];
    // From 1: what stands above "Accessing workspace:" is the tab's own past, as the live run shows, and is not this screen.
    for (let at = 1; at <= rows.length; at += 1) {
      for (const extra of [' A row with new words.', ...repeats]) {
        const shown = [...rows.slice(0, at), extra, ...rows.slice(at)];
        assert.equal(typeof onlyPlainTrustOf(shown, folder), 'string', `the row ${JSON.stringify(extra)} added at ${at}`);
      }
    }
  });
}

test('wrap: words moved over a row boundary so that their order changes are refused, in either direction', () => {
  // The first pair moves "project," down over the break, the second moves "source" down.
  const moved = [
    [' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source or',
      ' project, work from your team). If not, take a moment to review what\'s in this folder first.'],
    [' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open project, or',
      ' source work from your team). If not, take a moment to review what\'s in this folder first.'],
  ];
  const top = WIDE_PLAIN.indexOf(' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or');
  assert.ok(top > 0, 'the premise: the row is there');
  for (const [first, second] of moved) {
    const shown = [...WIDE_PLAIN.slice(0, top), first, second, ...WIDE_PLAIN.slice(top + 2)];
    assert.equal(shown.length, WIDE_PLAIN.length, 'the premise: as many rows, and the same words');
    assert.deepEqual(placesOf(shown).map(({ word }) => word).sort(), placesOf(WIDE_PLAIN).map(({ word }) => word).sort(), 'the premise: the same words');
    refused(onlyPlainTrustOf(shown, LIVE_FOLDER), first.trim());
  }
});

test('wrap: two rows in the other order are refused, though each is a row of the screen', () => {
  const at = WIDE_PLAIN.indexOf(' Security guide');
  const shown = [...WIDE_PLAIN.slice(0, at - 1), WIDE_PLAIN[at], WIDE_PLAIN[at - 1], ...WIDE_PLAIN.slice(at + 1)];
  refused(onlyPlainTrustOf(shown, LIVE_FOLDER), 'Security guide');
  const foot = [...WIDE_PLAIN.slice(0, -2), WIDE_PLAIN.at(-1), WIDE_PLAIN.at(-2)];
  refused(onlyPlainTrustOf(foot, LIVE_FOLDER), 'Enter to confirm');
});

test('wrap: the last row is compared to its end: a word taken off it, the whole row taken off, or a word added to it is refused', () => {
  refused(onlyPlainTrustOf([...WIDE_PLAIN.slice(0, -1), ' Enter to confirm · Esc to'], LIVE_FOLDER), 'lacks "cancel"');
  refused(onlyPlainTrustOf(WIDE_PLAIN.slice(0, -1), LIVE_FOLDER), 'lacks "Enter"');
  refused(onlyPlainTrustOf([...WIDE_PLAIN.slice(0, -1), ' Enter to confirm · Esc to cancel now'], LIVE_FOLDER), 'cancel now');
});

test('wrap: only the place a row breaks is free: two spaces between words, or a tab, are not the same words', () => {
  const at = WIDE_PLAIN.indexOf(' Claude Code\'ll be able to read, edit, and execute files here.');
  for (const row of [' Claude Code\'ll be able to  read, edit, and execute files here.', ' Claude Code\'ll be able to\tread, edit, and execute files here.']) {
    refused(onlyPlainTrustOf(WIDE_PLAIN.map((one, here) => (here === at ? row : one)), LIVE_FOLDER), row.trim());
  }
});

test('wrap: the folder takes only the three spellings of the run\'s own folder, and none of them with anything beside it', () => {
  const row = ` ${LIVE_FOLDER}`;
  const shown = (folder) => WIDE_PLAIN.map((one) => (one === row ? ` ${folder}` : one));
  const bare = LIVE_FOLDER.replace(/^\/private/, '');
  assert.equal(onlyPlainTrustOf(shown(LIVE_FOLDER), LIVE_FOLDER), undefined, 'as the test knows it');
  assert.equal(onlyPlainTrustOf(shown(bare), LIVE_FOLDER), undefined, 'with /private taken off');
  assert.equal(onlyPlainTrustOf(shown(LIVE_FOLDER), bare), undefined, 'with /private put on');
  for (const other of [`/private${LIVE_FOLDER}`, `${LIVE_FOLDER}/`, `${LIVE_FOLDER}-2`, `${LIVE_BOTS}/bots/other-bot`, `/tmp${bare}`, `${LIVE_FOLDER} ${LIVE_FOLDER}`]) {
    refused(onlyPlainTrustOf(shown(other), LIVE_FOLDER), other);
  }
});

test('wrap: a folder with a space in its path is still one folder, in its own place', () => {
  const folder = '/private/tmp/my bots/bots/daily';
  const shown = NARROW_PLAIN.map((row) => (row === ` ${FOLDER}` ? ` ${folder}` : row));
  assert.equal(onlyPlainTrustOf(shown, folder), undefined);
  refused(onlyPlainTrustOf(NARROW_PLAIN.map((row) => (row === ` ${FOLDER}` ? ' /private/tmp/bots my/bots/daily' : row)), folder), '/private/tmp/bots my/bots/daily');
});

test('wrap: rows that run together, with the same words in the same order, are refused where plainTrustOf wants a row of its own', () => {
  const together = (first, second) => {
    const at = WIDE_PLAIN.indexOf(first);
    assert.equal(WIDE_PLAIN[at + 1], second, `the premise: ${second} comes right after ${first}`);
    return [...WIDE_PLAIN.slice(0, at), `${first} ${second.trim()}`, ...WIDE_PLAIN.slice(at + 2)];
  };
  refused(onlyPlainTrustOf(together(' Accessing workspace:', ` ${LIVE_FOLDER}`), LIVE_FOLDER), 'does not show this test\'s folder');
  refused(onlyPlainTrustOf(together(' ❯ No, exit', '   Yes, I trust this folder'), LIVE_FOLDER), 'pointer is not on "No, exit"');
  refused(onlyPlainTrustOf(together('   Yes, I trust this folder', ' Enter to confirm · Esc to cancel'), LIVE_FOLDER), 'no "Yes, I trust this folder" choice');
});

test('wrap: on the live kit screen, every word outside the rule rows changed, removed, doubled or swapped with its neighbour is refused', () => {
  const places = placesOf(LIVE_ROWS).filter(({ at }) => at >= LIVE_TOP && (at <= LIVE_WARN || at >= LIVE_APPLY));
  for (const [index, place] of places.entries()) {
    const label = `row ${place.at}, word ${place.inRow}, "${place.word}"`;
    assert.equal(typeof claudeTrustOf(withWord(LIVE_ROWS, place, (word) => [`${word}x`]), LIVE_FOLDER, LIVE_KIT), 'string', `changed: ${label}`);
    assert.equal(typeof claudeTrustOf(withWord(LIVE_ROWS, place, () => []), LIVE_FOLDER, LIVE_KIT), 'string', `removed: ${label}`);
    assert.equal(typeof claudeTrustOf(withWord(LIVE_ROWS, place, (word) => [word, word]), LIVE_FOLDER, LIVE_KIT), 'string', `doubled: ${label}`);
    const next = places[index + 1];
    if (next === undefined || next.word === place.word || next.at - place.at > 1) continue;
    const swapped = LIVE_ROWS.map((row, here) => {
      if (here !== place.at && here !== next.at) return row;
      const words = row.trim().split(' ');
      if (here === place.at) words[place.inRow] = next.word;
      if (here === next.at) words[next.inRow] = place.word;
      return ` ${words.join(' ')}`;
    });
    assert.equal(typeof claudeTrustOf(swapped, LIVE_FOLDER, LIVE_KIT), 'string', `swapped: "${place.word}" and "${next.word}"`);
  }
});

test('wrap: on the live kit screen, an added row is refused at every place, the last included', () => {
  const repeats = [' A row with new words.', ...LIVE_ROWS.slice(LIVE_TOP).map((row) => row.trim()), 'cancel'];
  for (let at = LIVE_TOP + 1; at <= LIVE_ROWS.length; at += 1) {
    for (const extra of repeats) {
      // A rule row said twice inside the rule rows only says rules of the set again. onlyKitTrustOf's rule check takes that today, and keeps its checks as they are.
      if (LIVE_RULES.includes(extra) && at > LIVE_WARN && at <= LIVE_APPLY) continue;
      const shown = [...LIVE_ROWS.slice(0, at), extra, ...LIVE_ROWS.slice(at)];
      assert.equal(typeof claudeTrustOf(shown, LIVE_FOLDER, LIVE_KIT), 'string', `the row ${JSON.stringify(extra)} added at ${at}`);
    }
  }
});

test('wrap: a row of a rule list on the plain screen is refused: the words are not the plain screen\'s', () => {
  assert.deepEqual(LIVE_RULES.length, 2, 'the premise: the live screen lists its rules on two rows');
  for (const rule of LIVE_RULES) {
    const at = WIDE_PLAIN.indexOf(' Security guide');
    refused(onlyPlainTrustOf([...WIDE_PLAIN.slice(0, at), ` ${rule}`, ...WIDE_PLAIN.slice(at)], LIVE_FOLDER), rule);
  }
});

// ------------------------------------------------- Claude Code 2.1.326 (#786)

// Claude Code 2.1.326 shows one more row on the kit's trust screen, between
// "These will apply …" and "Security guide". The check takes exactly two kit
// screens (the architect's boundary on #786; the ruling on #451 stays): the one
// it holds now, for 2.1.325 (LIVE_ROWS above, whole word by word, line wrap
// free), and the one captured on 2.1.326 below. A word changed, added, removed
// or moved against both is refused, with the row named.

/** The throwaway bots folder of the #784 probe's run P2 (developer-751 design/receipts/784-probe-2.output.txt). */
const V326_BOTS = '/private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-added-parts-live-aMnjgU';

/** The CLI that run's kit called itself back with, as its launch line shows. */
const V326_CLI = '/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/developer-751/src/cli.js';

/** The bot folder its tab opened in, the folder the screen names. */
const V326_FOLDER = `${V326_BOTS}/bots/ap-fable-5-2`;

const V326_DEFAULTS = defaultRules(V326_BOTS, V326_CLI);
const V326_KIT = { allow: V326_DEFAULTS, defaults: V326_DEFAULTS };

/**
 * SEEN LIVE on 2026-11-17, in a tab of 137 columns, on Claude Code 2.1.326: the
 * rows the runner printed under "what it showed:", from the rule row across the
 * tab down, with the runner's indent of six spaces taken off and nothing else
 * changed. The paths are that run's own throwaway folder.
 */
const V326_ROWS = [
  '─'.repeat(137),
  ' Accessing workspace:',
  ' /private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-added-parts-live-aMnjgU/bots/ap-fable-5-2',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from',
  ' your team). If not, take a moment to review what\'s in this folder first.',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  ' ⚠ This folder pre-approves 32 tool permissions in .claude/settings.json:',
  '   Bash(/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/d…, Bash(git add:*), Bash(git commit:*), and',
  ' Read(//private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn…',
  ' These will apply without asking. Only proceed if you trust this configuration.',
  ' Trusting this folder loads .claude/settings.json (runs commands).',
  ' Security guide',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  ' Enter to confirm · Esc to cancel',
];

/** The row 2.1.326 added, as seen. */
const V326_NEW = ' Trusting this folder loads .claude/settings.json (runs commands).';

const V326_TOP = V326_ROWS.indexOf(' Accessing workspace:');
const V326_WARN = V326_ROWS.findIndex((row) => row.includes('pre-approves'));
const V326_APPLY = V326_ROWS.indexOf(' These will apply without asking. Only proceed if you trust this configuration.');
const V326_AT = V326_ROWS.indexOf(V326_NEW);
const V326_GUIDE = V326_ROWS.indexOf(' Security guide');

/** `rows` with the row at `at` taken out. */
const without = (rows, at) => [...rows.slice(0, at), ...rows.slice(at + 1)];

/** `rows` with `extra` put in at `at`. */
const putIn = (rows, at, extra) => [...rows.slice(0, at), extra, ...rows.slice(at)];

/** The words of a screen from "Accessing workspace:" down, its folder row as one word FOLDER. */
const screenWords = (rows, folder) => rows.slice(rows.findIndex((row) => row.includes('Accessing workspace:')))
  .flatMap((row) => (row.trim() === folder ? ['FOLDER'] : row.trim().split(' ')));

test('2.1.326 (#786): the premise: the capture is the 2.1.325 screen the check holds now, with one more row after "These will apply", its own folder, and its prose wrapped at 137 columns', () => {
  assert.equal(V326_ROWS[0].length, 137, 'the rule row across the tab has 137 columns');
  assert.deepEqual([V326_TOP, V326_WARN, V326_APPLY, V326_AT, V326_GUIDE], [1, 6, 9, 10, 11], 'the rows stand where the capture has them');
  assert.equal(V326_DEFAULTS.length, 32, 'the set is the 32 the screen counts');
  assert.deepEqual(screenWords(without(V326_ROWS, V326_AT), V326_FOLDER), screenWords(LIVE_ROWS, LIVE_FOLDER), 'without its new row, the same words in the same order');
});

test('2.1.326 (#786): the 2.1.325 screen is still answered', () => {
  assert.equal(claudeTrustOf(LIVE_ROWS, LIVE_FOLDER, LIVE_KIT), undefined, 'as seen live');
  assert.equal(claudeTrustOf(KIT_NOW, KIT_FOLDER, KIT), undefined, 'as the #555 capture, at 120 columns');
});

test('2.1.326 (#786): the 2.1.326 screen as captured is answered, by the one check every system test uses and by onlyKitTrustOf, in either spelling of a macOS temp path', () => {
  assert.equal(claudeTrustOf(V326_ROWS, V326_FOLDER, V326_KIT), undefined, 'claudeTrustOf');
  assert.equal(onlyKitTrustOf(V326_ROWS, V326_FOLDER, V326_KIT), undefined, 'onlyKitTrustOf');
  assert.equal(claudeTrustOf(V326_ROWS, V326_FOLDER.replace(/^\/private/, ''), V326_KIT), undefined, 'the screen shows /private/var, the test knows /var');
});

test('2.1.326 (#786): the new row moved to any other place is refused, naming it', () => {
  const alone = without(V326_ROWS, V326_AT);
  for (let at = V326_TOP + 1; at <= alone.length; at += 1) {
    if (at === V326_AT) continue;
    refused(claudeTrustOf(putIn(alone, at, V326_NEW), V326_FOLDER, V326_KIT), V326_NEW.trim());
  }
});

test('2.1.326 (#786): a word in the new row changed is refused, naming the row', () => {
  for (const changedRow of [
    ' Trusting this folder loads .claude/settings.json (runs hooks).',
    ' Trusting this folder loads .claude/settings.local.json (runs commands).',
    ' Trusting this folder runs .claude/settings.json (runs commands).',
  ]) {
    refused(claudeTrustOf(V326_ROWS.map((row, at) => (at === V326_AT ? changedRow : row)), V326_FOLDER, V326_KIT), changedRow.trim());
  }
});

test('2.1.326 (#786): a word in the new row taken out or added is refused, naming the row', () => {
  for (const changedRow of [
    ' Trusting this folder .claude/settings.json (runs commands).',
    ' Trusting this folder loads .claude/settings.json (runs all commands).',
  ]) {
    refused(claudeTrustOf(V326_ROWS.map((row, at) => (at === V326_AT ? changedRow : row)), V326_FOLDER, V326_KIT), changedRow.trim());
  }
});

// The brief for #786 asked that the 2.1.326 screen with its new row missing be
// refused. Without that row the screen is the 2.1.325 screen word for word (the
// premise test above), and the check answers that screen; so it is answered.
test('2.1.326 (#786): the 2.1.326 screen with its new row taken out is the 2.1.325 screen, and is answered as that', () => {
  assert.equal(claudeTrustOf(without(V326_ROWS, V326_AT), V326_FOLDER, V326_KIT), undefined);
});

test('2.1.326 (#786): the new row put in the 2.1.325 screen is answered only in its own place, after "These will apply"; at any other place it is refused, naming it', () => {
  const apply = LIVE_ROWS.findIndex((row) => row.startsWith(' These will apply'));
  for (let at = LIVE_TOP + 1; at <= LIVE_ROWS.length; at += 1) {
    const shown = putIn(LIVE_ROWS, at, V326_NEW);
    if (at === apply + 1) assert.equal(claudeTrustOf(shown, LIVE_FOLDER, LIVE_KIT), undefined, 'in its own place: the 2.1.326 screen');
    else refused(claudeTrustOf(shown, LIVE_FOLDER, LIVE_KIT), V326_NEW.trim());
  }
});

test('2.1.326 (#786): a row the check does not know is refused, naming it: in the 2.1.325 screen where the new row goes, in place of the new row, and beside it', () => {
  const unknown = ' Trusting this folder runs its hooks.';
  const apply = LIVE_ROWS.findIndex((row) => row.startsWith(' These will apply'));
  refused(claudeTrustOf(putIn(LIVE_ROWS, apply + 1, unknown), LIVE_FOLDER, LIVE_KIT), unknown.trim());
  refused(claudeTrustOf(V326_ROWS.map((row, at) => (at === V326_AT ? unknown : row)), V326_FOLDER, V326_KIT), unknown.trim());
  refused(claudeTrustOf(putIn(V326_ROWS, V326_AT, unknown), V326_FOLDER, V326_KIT), unknown.trim());
  refused(claudeTrustOf(putIn(V326_ROWS, V326_AT + 1, unknown), V326_FOLDER, V326_KIT), unknown.trim());
});

test('2.1.326 (#786): on the 2.1.326 screen, every word outside the rule rows changed, removed, doubled or swapped with its neighbour is refused', () => {
  assert.equal(claudeTrustOf(V326_ROWS, V326_FOLDER, V326_KIT), undefined, 'the premise: as it stands, it is answered');
  const places = placesOf(V326_ROWS).filter(({ at }) => at >= V326_TOP && (at <= V326_WARN || at >= V326_APPLY));
  for (const [index, place] of places.entries()) {
    const label = `row ${place.at}, word ${place.inRow}, "${place.word}"`;
    assert.equal(typeof claudeTrustOf(withWord(V326_ROWS, place, (word) => [`${word}x`]), V326_FOLDER, V326_KIT), 'string', `changed: ${label}`);
    assert.equal(typeof claudeTrustOf(withWord(V326_ROWS, place, () => []), V326_FOLDER, V326_KIT), 'string', `removed: ${label}`);
    assert.equal(typeof claudeTrustOf(withWord(V326_ROWS, place, (word) => [word, word]), V326_FOLDER, V326_KIT), 'string', `doubled: ${label}`);
    const next = places[index + 1];
    if (next === undefined || next.word === place.word || next.at - place.at > 1) continue;
    const swapped = V326_ROWS.map((row, here) => {
      if (here !== place.at && here !== next.at) return row;
      const words = row.trim().split(' ');
      if (here === place.at) words[place.inRow] = next.word;
      if (here === next.at) words[next.inRow] = place.word;
      return ` ${words.join(' ')}`;
    });
    assert.equal(typeof claudeTrustOf(swapped, V326_FOLDER, V326_KIT), 'string', `swapped: "${place.word}" and "${next.word}"`);
  }
});

test('2.1.326 (#786): on the 2.1.326 screen, an added row is refused at every place, the last included', () => {
  assert.equal(claudeTrustOf(V326_ROWS, V326_FOLDER, V326_KIT), undefined, 'the premise: as it stands, it is answered');
  const rules = V326_ROWS.slice(V326_WARN + 1, V326_APPLY).map((row) => row.trim());
  const extras = [' A row with new words.', ...V326_ROWS.slice(V326_TOP).map((row) => row.trim()), 'cancel'];
  for (let at = V326_TOP + 1; at <= V326_ROWS.length; at += 1) {
    for (const extra of extras) {
      // As on the 2.1.325 screen: a rule row said twice inside the rule rows only says rules of the set again.
      if (rules.includes(extra) && at > V326_WARN && at <= V326_APPLY) continue;
      assert.equal(typeof claudeTrustOf(putIn(V326_ROWS, at, extra), V326_FOLDER, V326_KIT), 'string', `the row ${JSON.stringify(extra)} added at ${at}`);
    }
  }
});

test('2.1.326 (#786): every other check stays on the 2.1.326 screen: the folder, the pointer, the two choices, the count, the rules and the allow list', () => {
  assert.equal(claudeTrustOf(V326_ROWS, V326_FOLDER, V326_KIT), undefined, 'the premise: as it stands, it is answered');
  const swapped = (from, to) => {
    assert.ok(V326_ROWS.includes(from), `the 2.1.326 screen has the row ${from}`);
    return V326_ROWS.flatMap((row) => (row === from ? (to === undefined ? [] : [to]) : [row]));
  };
  refused(claudeTrustOf(V326_ROWS, `${V326_BOTS}/bots/other-bot`, V326_KIT), V326_FOLDER);
  const onYes = swapped(' ❯ No, exit', '   No, exit').map((row) => (row === '   Yes, I trust this folder' ? ' ❯ Yes, I trust this folder' : row));
  refused(claudeTrustOf(onYes, V326_FOLDER, V326_KIT));
  refused(claudeTrustOf(swapped('   Yes, I trust this folder', undefined), V326_FOLDER, V326_KIT));
  refused(claudeTrustOf(swapped(V326_ROWS[V326_WARN], ' ⚠ This folder pre-approves 33 tool permissions in .claude/settings.json:'), V326_FOLDER, V326_KIT), '33');
  const rule = V326_ROWS[V326_WARN + 1];
  refused(claudeTrustOf(swapped(rule, rule.replace('Bash(git add:*)', 'Bash(rm -rf:*)')), V326_FOLDER, V326_KIT), 'Bash(rm -rf:*)');
  refused(claudeTrustOf(V326_ROWS, V326_FOLDER, { allow: [...V326_DEFAULTS.slice(1), 'Bash(rm -rf:*)'], defaults: V326_DEFAULTS }), 'Bash(rm -rf:*)');
  refused(claudeTrustOf(V326_ROWS, V326_FOLDER, { allow: [], defaults: V326_DEFAULTS }));
  refused(claudeTrustOf(swapped(V326_ROWS[V326_APPLY], ' These will apply without asking.'), V326_FOLDER, V326_KIT), 'These will apply');
  refused(claudeTrustOf(swapped(' Security guide', ' Security guide (read this first)'), V326_FOLDER, V326_KIT), 'Security guide');
  refused(onlyPlainTrustOf(V326_ROWS, V326_FOLDER));
});

// No plain screen (nothing pre-approved) was captured on 2.1.326, so the plain
// check keeps its one screen: the new row on it is refused.
test('2.1.326 (#786): the plain screen with the new row before "Security guide" is refused, naming the row', () => {
  for (const [rows, folder] of [[CLAUDE_TRUST, FOLDER], [WIDE_PLAIN, LIVE_FOLDER]]) {
    const shown = putIn(rows, rows.indexOf(' Security guide'), V326_NEW);
    refused(onlyPlainTrustOf(shown, folder), V326_NEW.trim());
    refused(claudeTrustOf(shown, folder, { allow: [], defaults: DEFAULTS }), V326_NEW.trim());
  }
});

// ------------------------------------------------- Claude Code 2.1.330 (#845)

// Claude Code 2.1.330 shows one more row on the kit's trust screen than 2.1.326
// did: a hooks row between "These will apply …" and the 2.1.326 row "Trusting
// this folder loads …". The ruling on #451 stays: the check takes exactly the
// captured screens (2.1.325, 2.1.326 and 2.1.330 below), whole word by word,
// line wrap free. A word changed, added, removed or moved against all of them is
// refused, with the row named. Every other check stays as it is.

/** The throwaway bots folder of the live run of test/system/mail-no-open-tab.test.js (developer-841 design/845-live-run-2026-11-21.output.txt). */
const V330_BOTS = '/private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-mail-no-open-tab-qoXKBP';

/** The CLI that run's kit called itself back with, as its launch line shows. */
const V330_CLI = '/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/developer-841/repo/src/cli.js';

/** The bot folder its tab opened in, the folder the screen names. */
const V330_FOLDER = `${V330_BOTS}/bots/no-open-tab`;

const V330_DEFAULTS = defaultRules(V330_BOTS, V330_CLI);
const V330_KIT = { allow: V330_DEFAULTS, defaults: V330_DEFAULTS };

/**
 * SEEN LIVE on 2026-11-21 at about 00:06 EST, in a tab of 156 columns, on Claude
 * Code 2.1.330: the rows in the failure message, from the rule row across the tab
 * down, with the reporter's indent of six spaces taken off and nothing else
 * changed (developer-841 design/845-v330-rows.json). The paths are that run's own
 * throwaway folder.
 */
const V330_ROWS = [
  '─'.repeat(156),
  ' Accessing workspace:',
  ' /private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-mail-no-open-tab-qoXKBP/bots/no-open-tab',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If',
  ' not, take a moment to review what\'s in this folder first.',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  ' ⚠ This folder pre-approves 32 tool permissions in .claude/settings.json:',
  '   Bash(/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/d…, Bash(git add:*), Bash(git commit:*), and',
  ' Read(//private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn…',
  ' These will apply without asking. Only proceed if you trust this configuration.',
  ' ⚠ This folder configures hooks that can run commands without asking, declared in .claude/settings.json',
  ' Trusting this folder loads .claude/settings.json (runs commands).',
  ' Security guide',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  ' Enter to confirm · Esc to cancel',
];

/** The row 2.1.330 added, as seen (no full stop at its end). */
const V330_NEW = ' ⚠ This folder configures hooks that can run commands without asking, declared in .claude/settings.json';

const V330_TOP = V330_ROWS.indexOf(' Accessing workspace:');
const V330_WARN = V330_ROWS.findIndex((row) => row.includes('pre-approves'));
const V330_APPLY = V330_ROWS.indexOf(' These will apply without asking. Only proceed if you trust this configuration.');
const V330_AT = V330_ROWS.indexOf(V330_NEW);
const V330_TRUSTING = V330_ROWS.indexOf(V326_NEW);
const V330_GUIDE = V330_ROWS.indexOf(' Security guide');

/**
 * How a refusal names the new row put in at `at` of a screen whose warning row is
 * at `warn` and whose "These will apply" row is at `apply`. Inside the rule rows
 * the kit's rule check (kept as it is) reads the row as a list of rules and names
 * its first item, the words before its comma; anywhere else the whole row.
 */
const v330Named = (at, warn, apply) => (at > warn && at <= apply
  ? '⚠ This folder configures hooks that can run commands without asking'
  : V330_NEW.trim());

/** The 2.1.330 screen with its new row changed to `to`. */
const v330With = (to) => V330_ROWS.map((row, at) => (at === V330_AT ? to : row));

test('2.1.330 (#845): the premise: the capture is the 2.1.326 screen with one more row after "These will apply", its own folder, and its prose wrapped at 156 columns', () => {
  assert.equal(V330_ROWS[0].length, 156, 'the rule row across the tab has 156 columns');
  assert.deepEqual([V330_TOP, V330_WARN, V330_APPLY, V330_AT, V330_TRUSTING, V330_GUIDE], [1, 6, 9, 10, 11, 12], 'the rows stand where the capture has them');
  assert.equal(V330_DEFAULTS.length, 32, 'the set is the 32 the screen counts');
  assert.deepEqual(screenWords(without(V330_ROWS, V330_AT), V330_FOLDER), screenWords(V326_ROWS, V326_FOLDER), 'without its new row, the same words in the same order as the 2.1.326 capture');
});

test('2.1.330 (#845): the 2.1.325 and 2.1.326 screens are still answered', () => {
  assert.equal(claudeTrustOf(LIVE_ROWS, LIVE_FOLDER, LIVE_KIT), undefined, '2.1.325, as seen live');
  assert.equal(claudeTrustOf(KIT_NOW, KIT_FOLDER, KIT), undefined, '2.1.325, as the #555 capture, at 120 columns');
  assert.equal(claudeTrustOf(V326_ROWS, V326_FOLDER, V326_KIT), undefined, '2.1.326, as captured');
  assert.equal(onlyKitTrustOf(V326_ROWS, V326_FOLDER, V326_KIT), undefined, '2.1.326, by onlyKitTrustOf');
});

test('2.1.330 (#845): the 2.1.330 screen as captured is answered, by the one check every system test uses and by onlyKitTrustOf, in either spelling of a macOS temp path', () => {
  assert.equal(claudeTrustOf(V330_ROWS, V330_FOLDER, V330_KIT), undefined, 'claudeTrustOf');
  assert.equal(onlyKitTrustOf(V330_ROWS, V330_FOLDER, V330_KIT), undefined, 'onlyKitTrustOf');
  const bare = V330_FOLDER.replace(/^\/private/, '');
  assert.equal(claudeTrustOf(V330_ROWS, bare, V330_KIT), undefined, 'the screen shows /private/var, the test knows /var');
  assert.equal(onlyKitTrustOf(V330_ROWS, bare, V330_KIT), undefined, 'the screen shows /private/var, the test knows /var, by onlyKitTrustOf');
  const shown = V330_ROWS.map((row) => (row === ` ${V330_FOLDER}` ? ` ${bare}` : row));
  assert.equal(claudeTrustOf(shown, V330_FOLDER, V330_KIT), undefined, 'the screen shows /var, the test knows /private/var');
});

test('2.1.330 (#845): the new row moved to any other place is refused, naming it', () => {
  const alone = without(V330_ROWS, V330_AT);
  for (let at = V330_TOP + 1; at <= alone.length; at += 1) {
    if (at === V330_AT) continue;
    refused(claudeTrustOf(putIn(alone, at, V330_NEW), V330_FOLDER, V330_KIT), v330Named(at, V330_WARN, V330_APPLY));
  }
});

test('2.1.330 (#845): the two new rows in the other order, "Trusting this folder loads" first, are refused, naming the hooks row', () => {
  const other = V330_ROWS.map((row, at) => (at === V330_AT ? V326_NEW : at === V330_TRUSTING ? V330_NEW : row));
  assert.deepEqual([other[V330_AT], other[V330_TRUSTING]], [V326_NEW, V330_NEW], 'the premise: the two rows swapped');
  refused(claudeTrustOf(other, V330_FOLDER, V330_KIT), V330_NEW.trim());
});

test('2.1.330 (#845): a word in the new row changed is refused, naming the row', () => {
  for (const changedRow of [
    ' ⚠ This folder configures hooks that can run commands without asking, declared in .claude/settings.local.json',
    ' ⚠ This folder configures scripts that can run commands without asking, declared in .claude/settings.json',
    ' ⚠ This folder configures hooks that can run commands after asking, declared in .claude/settings.json',
    ' ⚠ This folder configures hooks that can run commands without asking, declared in .claude/settings.json.',
    ' ! This folder configures hooks that can run commands without asking, declared in .claude/settings.json',
  ]) {
    refused(claudeTrustOf(v330With(changedRow), V330_FOLDER, V330_KIT), changedRow.trim());
  }
});

test('2.1.330 (#845): a word in the new row taken out or added is refused, naming the row', () => {
  for (const changedRow of [
    ' ⚠ This folder configures hooks that can run commands asking, declared in .claude/settings.json',
    ' This folder configures hooks that can run commands without asking, declared in .claude/settings.json',
    ' ⚠ This folder configures hooks that can run commands without asking, declared in',
    ' ⚠ This folder configures hooks that can run any commands without asking, declared in .claude/settings.json',
    ' ⚠ This folder configures hooks that can run commands without asking, declared in .claude/settings.json and more',
  ]) {
    refused(claudeTrustOf(v330With(changedRow), V330_FOLDER, V330_KIT), changedRow.trim());
  }
});

test('2.1.330 (#845): a word in the new row moved is refused, naming the row', () => {
  for (const changedRow of [
    ' ⚠ This folder configures hooks that can run without asking commands, declared in .claude/settings.json',
    ' ⚠ This folder configures hooks that run can commands without asking, declared in .claude/settings.json',
    ' ⚠ This folder hooks configures that can run commands without asking, declared in .claude/settings.json',
  ]) {
    refused(claudeTrustOf(v330With(changedRow), V330_FOLDER, V330_KIT), changedRow.trim());
  }
});

// Without its new row the 2.1.330 screen is the 2.1.326 screen word for word (the
// premise test above), and without both new rows it is the 2.1.325 screen; the
// check answers those, line wrap free.
test('2.1.330 (#845): the 2.1.330 screen with its new row taken out is the 2.1.326 screen, and with both new rows taken out the 2.1.325 screen, and is answered as that', () => {
  assert.equal(claudeTrustOf(without(V330_ROWS, V330_AT), V330_FOLDER, V330_KIT), undefined, 'the 2.1.326 words');
  assert.equal(claudeTrustOf(without(without(V330_ROWS, V330_TRUSTING), V330_AT), V330_FOLDER, V330_KIT), undefined, 'the 2.1.325 words');
});

// Only captured screens: the hooks row without the 2.1.326 row after it was never
// captured. Which row the refusal names is left to the check (the hooks row is
// one too many against 2.1.325; "Security guide" stands where 2.1.330 has
// "Trusting this folder loads"), so these assert the refusal only.
test('2.1.330 (#845): the hooks row without the 2.1.326 row after it was never captured, and is refused', () => {
  refused(claudeTrustOf(without(V330_ROWS, V330_TRUSTING), V330_FOLDER, V330_KIT));
  refused(onlyKitTrustOf(without(V330_ROWS, V330_TRUSTING), V330_FOLDER, V330_KIT));
  const apply = LIVE_ROWS.findIndex((row) => row.startsWith(' These will apply'));
  refused(claudeTrustOf(putIn(LIVE_ROWS, apply + 1, V330_NEW), LIVE_FOLDER, LIVE_KIT));
});

test('2.1.330 (#845): the new row put in the 2.1.325 screen is refused at every place, naming it where it stands anywhere but after "These will apply"', () => {
  const apply = LIVE_ROWS.findIndex((row) => row.startsWith(' These will apply'));
  for (let at = LIVE_TOP + 1; at <= LIVE_ROWS.length; at += 1) {
    const said = claudeTrustOf(putIn(LIVE_ROWS, at, V330_NEW), LIVE_FOLDER, LIVE_KIT);
    if (at === apply + 1) refused(said);
    else refused(said, v330Named(at, LIVE_WARN, apply));
  }
});

test('2.1.330 (#845): the new row put in the 2.1.326 screen is answered only in its own place, after "These will apply"; at any other place it is refused, naming it', () => {
  for (let at = V326_TOP + 1; at <= V326_ROWS.length; at += 1) {
    const shown = putIn(V326_ROWS, at, V330_NEW);
    if (at === V326_APPLY + 1) assert.equal(claudeTrustOf(shown, V326_FOLDER, V326_KIT), undefined, 'in its own place: the 2.1.330 screen, wrapped at 137 columns');
    else refused(claudeTrustOf(shown, V326_FOLDER, V326_KIT), v330Named(at, V326_WARN, V326_APPLY));
  }
});

test('2.1.330 (#845): a row the check does not know is refused, naming it: in place of the new row, and beside it', () => {
  const unknown = ' ⚠ This folder configures hooks that run when Claude Code starts.';
  refused(claudeTrustOf(v330With(unknown), V330_FOLDER, V330_KIT), unknown.trim());
  refused(claudeTrustOf(putIn(V330_ROWS, V330_AT, unknown), V330_FOLDER, V330_KIT), unknown.trim());
  refused(claudeTrustOf(putIn(V330_ROWS, V330_AT + 1, unknown), V330_FOLDER, V330_KIT), unknown.trim());
});

test('2.1.330 (#845): on the 2.1.330 screen, every word outside the rule rows changed, removed, doubled or swapped with its neighbour is refused', () => {
  assert.equal(claudeTrustOf(V330_ROWS, V330_FOLDER, V330_KIT), undefined, 'the premise: as it stands, it is answered');
  const places = placesOf(V330_ROWS).filter(({ at }) => at >= V330_TOP && (at <= V330_WARN || at >= V330_APPLY));
  for (const [index, place] of places.entries()) {
    const label = `row ${place.at}, word ${place.inRow}, "${place.word}"`;
    assert.equal(typeof claudeTrustOf(withWord(V330_ROWS, place, (word) => [`${word}x`]), V330_FOLDER, V330_KIT), 'string', `changed: ${label}`);
    assert.equal(typeof claudeTrustOf(withWord(V330_ROWS, place, () => []), V330_FOLDER, V330_KIT), 'string', `removed: ${label}`);
    assert.equal(typeof claudeTrustOf(withWord(V330_ROWS, place, (word) => [word, word]), V330_FOLDER, V330_KIT), 'string', `doubled: ${label}`);
    const next = places[index + 1];
    if (next === undefined || next.word === place.word || next.at - place.at > 1) continue;
    const swapped = V330_ROWS.map((row, here) => {
      if (here !== place.at && here !== next.at) return row;
      const words = row.trim().split(' ');
      if (here === place.at) words[place.inRow] = next.word;
      if (here === next.at) words[next.inRow] = place.word;
      return ` ${words.join(' ')}`;
    });
    assert.equal(typeof claudeTrustOf(swapped, V330_FOLDER, V330_KIT), 'string', `swapped: "${place.word}" and "${next.word}"`);
  }
});

test('2.1.330 (#845): on the 2.1.330 screen, an added row is refused at every place, the last included', () => {
  assert.equal(claudeTrustOf(V330_ROWS, V330_FOLDER, V330_KIT), undefined, 'the premise: as it stands, it is answered');
  const rules = V330_ROWS.slice(V330_WARN + 1, V330_APPLY).map((row) => row.trim());
  const extras = [' A row with new words.', ...V330_ROWS.slice(V330_TOP).map((row) => row.trim()), 'cancel'];
  for (let at = V330_TOP + 1; at <= V330_ROWS.length; at += 1) {
    for (const extra of extras) {
      // As on the 2.1.325 screen: a rule row said twice inside the rule rows only says rules of the set again.
      if (rules.includes(extra) && at > V330_WARN && at <= V330_APPLY) continue;
      assert.equal(typeof claudeTrustOf(putIn(V330_ROWS, at, extra), V330_FOLDER, V330_KIT), 'string', `the row ${JSON.stringify(extra)} added at ${at}`);
    }
  }
});

test('2.1.330 (#845): every other check stays on the 2.1.330 screen: the folder, the pointer, the two choices, the count, the rules and the allow list', () => {
  assert.equal(claudeTrustOf(V330_ROWS, V330_FOLDER, V330_KIT), undefined, 'the premise: as it stands, it is answered');
  const swapped = (from, to) => {
    assert.ok(V330_ROWS.includes(from), `the 2.1.330 screen has the row ${from}`);
    return V330_ROWS.flatMap((row) => (row === from ? (to === undefined ? [] : [to]) : [row]));
  };
  refused(claudeTrustOf(V330_ROWS, `${V330_BOTS}/bots/other-bot`, V330_KIT), V330_FOLDER);
  refused(claudeTrustOf(V330_ROWS, '/private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn/T/obk-system-other-ZZZZZZ/bots/no-open-tab', V330_KIT), V330_FOLDER);
  const onYes = swapped(' ❯ No, exit', '   No, exit').map((row) => (row === '   Yes, I trust this folder' ? ' ❯ Yes, I trust this folder' : row));
  refused(claudeTrustOf(onYes, V330_FOLDER, V330_KIT));
  refused(claudeTrustOf(swapped('   Yes, I trust this folder', undefined), V330_FOLDER, V330_KIT));
  refused(claudeTrustOf(swapped(' ❯ No, exit', undefined), V330_FOLDER, V330_KIT));
  refused(claudeTrustOf(swapped(V330_ROWS[V330_WARN], ' ⚠ This folder pre-approves 33 tool permissions in .claude/settings.json:'), V330_FOLDER, V330_KIT), '33');
  refused(claudeTrustOf(swapped(V330_ROWS[V330_WARN], ' ⚠ This folder pre-approves 31 tool permissions in .claude/settings.json:'), V330_FOLDER, V330_KIT), '31');
  const rule = V330_ROWS[V330_WARN + 1];
  refused(claudeTrustOf(swapped(rule, rule.replace('Bash(git add:*)', 'Bash(rm -rf:*)')), V330_FOLDER, V330_KIT), 'Bash(rm -rf:*)');
  refused(claudeTrustOf(V330_ROWS, V330_FOLDER, { allow: [...V330_DEFAULTS.slice(1), 'Bash(rm -rf:*)'], defaults: V330_DEFAULTS }), 'Bash(rm -rf:*)');
  refused(claudeTrustOf(V330_ROWS, V330_FOLDER, { allow: [...V330_DEFAULTS, 'Bash(rm -rf:*)'], defaults: V330_DEFAULTS }), 'Bash(rm -rf:*)');
  refused(claudeTrustOf(V330_ROWS, V330_FOLDER, { allow: [], defaults: V330_DEFAULTS }));
  // The defaults of another bots folder are not this tab's allow list.
  refused(claudeTrustOf(V330_ROWS, V330_FOLDER, { allow: V326_DEFAULTS, defaults: V330_DEFAULTS }));
  refused(claudeTrustOf(swapped(V330_ROWS[V330_APPLY], ' These will apply without asking.'), V330_FOLDER, V330_KIT), 'These will apply');
  refused(claudeTrustOf(swapped(' Security guide', ' Security guide (read this first)'), V330_FOLDER, V330_KIT), 'Security guide');
  refused(onlyPlainTrustOf(V330_ROWS, V330_FOLDER));
  refused(plainTrustOf(V330_ROWS, V330_FOLDER));
});

// No plain screen (nothing pre-approved) was captured on 2.1.330, so the plain
// check keeps its one screen: the new row on it is refused, alone or with the
// 2.1.326 row after it.
test('2.1.330 (#845): the plain screen with the new row before "Security guide" is refused, naming the row', () => {
  for (const [rows, folder] of [[CLAUDE_TRUST, FOLDER], [WIDE_PLAIN, LIVE_FOLDER]]) {
    const guide = rows.indexOf(' Security guide');
    for (const shown of [putIn(rows, guide, V330_NEW), putIn(putIn(rows, guide, V326_NEW), guide, V330_NEW)]) {
      refused(onlyPlainTrustOf(shown, folder), V330_NEW.trim());
      refused(claudeTrustOf(shown, folder, { allow: [], defaults: DEFAULTS }), V330_NEW.trim());
    }
  }
});
