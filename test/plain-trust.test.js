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

/**
 * The pinned screen as this kit brings it up: its count row for the default
 * set as it is now, every other row as captured. The #555 run's clone gave 36
 * rules; #539 added 'session nudge' and 'session mail' to the default commands
 * after that clone was cut, and the rules Claude Code lists here are the same.
 */
const KIT_NOW = KIT_SCREEN.map((row) => (row === WARN_CAPTURED ? WARN : row));
const LIST_1 = '   Bash(/Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/d…, Bash(git add:*), Bash(git commit:*), Bash(orca';
const LIST_2 = ' orchestration check --run:*), and Read(//private/var/folders/9c/kh9z1_yd1gq9y0x3pm7h79cm0000gn…';
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

test('kit trust: the kit\'s default set for the captured paths had 36 rules at the capture, all different (a change to the defaults shows here first)', () => {
  const added = ['session nudge', 'session mail'].map((command) => `Bash(${KIT_CLI} ${command} --bots ${KIT_BOTS}:*)`);
  for (const rule of added) assert.ok(DEFAULTS.includes(rule), `${rule} is a default now`);
  assert.equal(DEFAULTS.filter((rule) => !added.includes(rule)).length, 36, 'the 36 the screen counted, without the two added since');
  assert.equal(new Set(DEFAULTS).size, DEFAULTS.length);
  assert.ok(DEFAULTS.includes('Bash(git add:*)') && DEFAULTS.includes('Bash(orca orchestration check --run:*)'), 'the whole rules the screen lists are in the set');
});

test('kit trust: the pinned screen as captured, its count 36, is refused for the default set as it is now', () => {
  refused(claudeTrustOf(KIT_SCREEN, KIT_FOLDER, KIT), '36');
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
    ['the warning for another file', swap(WARN, ' ⚠ This folder pre-approves 36 tool permissions in .claude/settings.local.json:')],
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
