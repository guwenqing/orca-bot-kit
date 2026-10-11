// What a harness tab shows, as Orca renders it: `orca terminal read --terminal
// <handle> --screen --json` answers with `result.terminal.tail`, one string per
// row of the rendered screen, and `source: "screen"` (Orca 1.4.212, #329).
// These are the screens the suite puts in front of the kit, and the look the
// system tests make before they type.
//
// Each screen says where it comes from. A capture is the whole `tail` of one
// live read, taken on 2026-09-26 from tabs the kit made in throwaway fleets,
// with this machine's full paths put back to `<kit clone>` and `<tmp>` and
// nothing else changed; where a path ran across two rows, only where those
// rows end moved. The pieces Codex shortened itself (`/private/var/folders/s5/…`)
// and the path in a typed draft are as they were. A reconstruction is built
// from words that were recorded (the issue, the tech notes) with the layout
// between them made up here.
//
// What makes a screen a harness's own question, for the kit and for the look
// below: a numbered choice list, the harness's selection pointer (`›` on Codex,
// `❯` on Claude Code) on one numbered choice and another numbered choice lined
// up with it on the row right above or below, taken at the lowest row on the
// screen the pointer starts. Numbered, because both harnesses start their input
// line with the same pointer, and Codex puts a status row right under it, lined
// up with its text and starting with a word: an unnumbered rule would take
// every idle Codex tab for a question. The lowest pointer row, because both
// harnesses echo the user's past turns with the pointer too, a long one wrapped
// onto more rows, and those sit above the input line.
//
// Claude Code's folder-trust list has no numbers, so it is not a question by
// that rule. Nothing is lost there: Orca names no agent in that tab and its
// `tui-idle` wait times out (both seen live, for minutes), so the kit's gate
// types nothing into it and the system tests' waits never pass it.
//
// Nor is Claude Code 2.1.283's "Teach auto mode about your environment?", a
// form with no numbers whose Enter is Continue (#416). So the system tests'
// look below also counts a form or menu by the keys its foot row offers
// ("Enter to continue", "Enter to confirm", "Esc to cancel", and Codex's
// "enter select" and the like) on the lowest pointer row or below it,
// where the input line would be: the same words higher up are history. That
// takes in the trust list too, which the kit need not see.
//
// Claude Code 2.1.289 draws its Teach list above its input box, and the box's
// own `❯` stays the lowest pointer row (#491). So a numbered choice list with
// the pointer on one, or a foot row, counts too when it is the last thing
// drawn right above the box's top rule. With anything after it, it is history.
//
// Claude Code's panel of feedback drafts is no list and has no pointer, but it
// takes single keys from the input line, and one of them sends a draft to
// Anthropic (#502). So for the kit it counts as well, when it is the last thing
// drawn right above the input box's top rule; its words higher up, with
// anything after them, are history. The look below does not see it.

/**
 * Claude Code 2.1.283 at its idle input line, showing its placeholder: a
 * capture, the whole `tail` of a kit-made tab after its trust list was
 * answered. What the fake Orca shows for a tab a test says nothing about,
 * unless a Codex launch line was typed into it.
 */
export const CLAUDE_IDLE = [
  ' ▐▛███▛█   Claude Code v2.1.283',
  '▝▜██████▀  Opus 5.5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-dev2-capture-5CkZDQ/bots/bot-father · /rc',
  '                                                                                                     ◉ xhigh · /effort',
  '──────────────────────────────────────────────────────────────────────────────────────────── bot-father.daily.r796uyiz ─',
  '❯ Try "fix typecheck errors"',
  '────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
];

/**
 * The bottom of Claude Code 2.1.283's screen with its input line empty: the
 * last four rows of CLAUDE_ANSWERED, as captured. The reconstructions below
 * stand on it.
 */
const CLAUDE_INPUT_LINE = [
  '──────────────────────────────────────────────────────────────────────────────────────────── bot-father.daily.r796uyiz ─',
  '❯',
  '────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
];

/**
 * Claude Code 2.1.283 after an answered turn: a capture. The echoed turn wraps
 * onto a second row lined up under its text, and that row holds a numbered
 * pair, `1. one 2. two`; the input line is empty below it. Not a question.
 */
export const CLAUDE_ANSWERED = [
  ' ▐▛███▛█   Claude Code v2.1.283',
  '▝▜██████▀  Opus 5.5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-dev2-capture-5CkZDQ/bots/bot-father · /rc',
  '❯ Reply with the single word OK and nothing else, and use no tool. This line is long on purpose so that it wraps onto',
  '  more than one row of the screen, the way a fleet mail nudge does: 1. one 2. two',
  '⏺ OK',
  '✻ Cooked for 1s · done 4:14 AM',
  ...CLAUDE_INPUT_LINE,
];

/**
 * Codex 0.157.1 at its idle input line: a capture (the box's own `…` is
 * Codex's). The status row right under `› Ask Codex to do anything` is lined up
 * with its text and starts with a word, the same shape as an unnumbered choice
 * list. What the fake Orca shows for a tab a test says nothing about, when a
 * Codex launch line was typed into it. Not a question.
 */
export const CODEX_IDLE = [
  '╭─────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.1)                          │',
  '│                                                     │',
  '│ model:     GPT-6-Luna medium   /model to change     │',
  '│ directory: /private/var/folders/s5/…/bots/cap-codex │',
  '╰─────────────────────────────────────────────────────╯',
  '                                        Tip: Visit the Codex community forum (https://community.openai.com/c/codex/37).',
  '› Ask Codex to do anything',
  '  GPT-6-Luna medium · <tmp>/obk-dev2-capture-5CkZDQ/bots/cap-codex',
  '  ? for shortcuts                                                                             ⚠ 2 warnings · f2 to view',
];

/**
 * Codex 0.157.1 with a long draft in its input line, not sent yet, wrapped
 * onto three rows lined up under its text, the status rows below: a capture.
 * Not a question.
 */
export const CODEX_DRAFT = [
  '╭─────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.1)                          │',
  '│                                                     │',
  '│ model:     GPT-6-Luna medium   /model to change     │',
  '│ directory: /private/var/folders/s5/…/bots/cap-codex │',
  '╰─────────────────────────────────────────────────────╯',
  '› Reply with the single word OK and nothing else, and run no command. This line is long on purpose so that it wraps',
  '  onto more than one row of the screen, the way a fleet mail nudge with its full paths does: /private/var/folders/s5/',
  '  example/obk-dev2-capture/bots/cap-codex message check',
  '  GPT-6-Luna medium · <tmp>/obk-dev2-capture-5CkZDQ/bots/cap-codex',
  '                                                                                              ⚠ 2 warnings · f2 to view',
];

/**
 * Codex 0.157.1 after an answered turn: a capture. The echoed turn sits above,
 * wrapped, and the idle input line below. Not a question.
 */
export const CODEX_ANSWERED = [
  '╭─────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.1)                          │',
  '│                                                     │',
  '│ model:     GPT-6-Luna medium   /model to change     │',
  '│ directory: /private/var/folders/s5/…/bots/cap-codex │',
  '╰─────────────────────────────────────────────────────╯',
  '› Reply with the single word OK and nothing else, and run no command. This line is long on purpose so that it wraps',
  '  onto more than one row of the screen, the way a fleet mail nudge with its full paths does: /private/var/folders/s5/',
  '  example/obk-dev2-capture/bots/cap-codex message check',
  '• OK',
  '  4:13 AM',
  '                                                  Tip: Use /init to create an AGENTS.md with project-specific guidance.',
  '› Ask Codex to do anything',
  '  GPT-6-Luna medium · <tmp>/obk-dev2-capture-5CkZDQ/bots/cap-codex ·…',
  '  ? for shortcuts                                                                             ⚠ 2 warnings · f2 to view',
];

/**
 * Codex 0.157.1 at its idle input line right after its folder-trust question
 * and its hooks review were answered, its start prompt echoed above: a capture
 * from #342 (the architect's live run, 2026-09-26). The screen Orca went on
 * calling `agent-trust-workspace` when it was seen live; in this capture's own
 * run Orca's wait named no reason. Not a question.
 */
export const CODEX_AFTER_TRUST = [
  '╭─────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.1)                          │',
  '│                                                     │',
  '│ model:     GPT-6-Luna medium   /model to change     │',
  '│ directory: /private/var/folders/s5/…/bots/cap-codex │',
  '╰─────────────────────────────────────────────────────╯',
  '› You are a throwaway bot for one capture and own nothing. Say nothing now and wait.',
  '  1:00 PM',
  '                                                     Tip: Paste an image with Ctrl+V to attach it to your next message.',
  '› Ask Codex to do anything',
  '  GPT-6-Luna medium · <tmp>/obk-capture-342-qeq4663w/bots/cap-codex …',
  '  ? for shortcuts                                                                              ⚠ 1 warning · f2 to view',
];

/**
 * Codex 0.157.1's update offer, the screen issue #329 is about: a line typed
 * with a return took its default, "Update now", and Codex updated the machine.
 * A reconstruction: the words are the pieces the issue quotes (the `…` inside
 * the command is the issue's, not the screen's), and the layout between them
 * was not captured. The blank rows under the footer are the rest of the screen;
 * the captures end at their last drawn row and this one does not, so a look
 * that reads only the very last row is caught either way.
 */
export const CODEX_UPDATE_OFFER = [
  '',
  '  ✨ Update available! 0.156.1 -> 0.157.1',
  '',
  "› 1. Update now (runs `sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | … sh'`)",
  '  2. Skip',
  '  3. Skip until next version',
  '',
  '  enter continue · esc skip',
  '',
  '',
  '',
  '',
];

/**
 * Codex 0.157.1's `/new` menu, put up after an answered turn, the echo of that
 * turn above it: a capture. Orca answered `tui-idle` satisfied, with no reason.
 */
export const CODEX_NEW_MENU = [
  '╭─────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.1)                          │',
  '│                                                     │',
  '│ model:     GPT-6-Luna medium   /model to change     │',
  '│ directory: /private/var/folders/s5/…/bots/cap-codex │',
  '╰─────────────────────────────────────────────────────╯',
  '› Reply with the single word OK and nothing else, and run no command. This line is long on purpose so that it wraps',
  '  onto more than one row of the screen, the way a fleet mail nudge with its full paths does: /private/var/folders/s5/',
  '  example/obk-dev2-capture/bots/cap-codex message check',
  '• OK',
  '  4:13 AM',
  '  Where should the new conversation run?',
  '› 1. Current checkout  Keep using the current working directory',
  '  2. New worktree      Create an isolated managed checkout',
  '  enter select · esc back',
];

/**
 * Codex 0.162.0's `/new` question, put up after one turn, the echo of that
 * turn above it: its first choice is renamed "Use current Git worktree". A
 * capture from a probe for #516 (2026-10-10, Orca 1.4.223), the key
 * "/new entered +1500ms" of its captures2.json, a read with no draft; the read
 * at +3000ms gave the same rows. The probe's folder,
 * /private/tmp/obk-probe-516b.EK7BP1, is put back to
 * `<tmp>/obk-probe-516b.EK7BP1`, and nothing else changed.
 */
export const CODEX_162_NEW_MENU = [
  '  >_ OpenAI Codex (v0.162.0)',
  '     <tmp>/obk-probe-516b.EK7BP1',
  '› Reply with the single word ok, and do nothing else.',
  '• ok',
  '  Worked for 3s • 4:24 AM',
  '  Where should the new conversation run?',
  '› 1. Use current Git worktree  Keep using the current working directory',
  '  2. Create new Git worktree   Create a separate checkout of this repository in another directory',
  '  enter select · esc back',
];

/**
 * CODEX_162_NEW_MENU with its selection moved down to `2. Create new Git
 * worktree`. A reconstruction: only the pointer moved.
 */
export const CODEX_162_NEW_MENU_ON_TWO = CODEX_162_NEW_MENU.map((row) => {
  if (row.startsWith('› 1. Use current Git worktree')) return `  ${row.slice(2)}`;
  if (row.startsWith('  2. Create new Git worktree')) return `› ${row.slice(2)}`;
  return row;
});

/**
 * CODEX_162_NEW_MENU with the selected row's choice and description as
 * captured, and `spaces` spaces between them in place of the captured two:
 * column padding, which row 2 of the capture shows as three, so it can change
 * with the pane's width or the next Codex. A reconstruction: only the padding
 * changed.
 */
const codex162NewMenuPadded = (spaces) => CODEX_162_NEW_MENU.map((row) => (
  row.startsWith('› 1. Use current Git worktree')
    ? `› 1. Use current Git worktree${' '.repeat(spaces)}Keep using the current working directory`
    : row
));

/** CODEX_162_NEW_MENU with three spaces before the selected row's description. A reconstruction. */
export const CODEX_162_NEW_MENU_PADDED_3 = codex162NewMenuPadded(3);

/** CODEX_162_NEW_MENU with eight spaces before the selected row's description. A reconstruction. */
export const CODEX_162_NEW_MENU_PADDED_8 = codex162NewMenuPadded(8);

/**
 * CODEX_162_NEW_MENU with the selected row's choice as captured and another
 * description after it. A reconstruction made up to test the rule: no such
 * row was seen, and its words are made up.
 */
export const CODEX_162_NEW_MENU_OTHER_WORDS = CODEX_162_NEW_MENU.map((row) => (
  row.startsWith('› 1. Use current Git worktree') ? '› 1. Use current Git worktree  Move the working directory into a new checkout' : row
));

/**
 * CODEX_162_NEW_MENU with the selected row's choice as captured and no
 * description after it. A reconstruction made up to test the rule.
 */
export const CODEX_162_NEW_MENU_NO_WORDS = CODEX_162_NEW_MENU.map((row) => (
  row.startsWith('› 1. Use current Git worktree') ? '› 1. Use current Git worktree' : row
));

/**
 * Codex 0.157.1's folder-trust question, its selection on the first choice: a
 * capture, from an orphaned tab, read with `source: "screen"`. Orca named a
 * reason for this one, `agent-trust-workspace`; a test that puts it in front
 * of the kit with none is asking about the screen alone.
 */
export const CODEX_TRUST = [
  '  Folder access',
  '  <tmp>/obk-system-question-Xygmnk/bots/question-codex',
  '  Note: You’re in a subdirectory of a Git project. Trusting will apply to the repository root:',
  '  <tmp>/obk-system-question-Xygmnk',
  '  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings. Folder settings',
  '  can run code automatically, even without a model request. Continue only if you trust these files. Your trust',
  '  decision will be saved.',
  '› 1. Trust and continue',
  '  2. Quit',
  '  enter continue · esc quit',
];

/**
 * Codex 0.157.1's hooks review, which the kit's own hook brings up, its
 * selection on `1`: a capture. Orca answered `tui-idle` satisfied, with no
 * reason: the first screen of a fresh kit-made Codex tab, and one the old
 * guard let a line into.
 */
export const CODEX_HOOKS_REVIEW = [
  '  Hooks need review',
  '  1 hook is new or changed.',
  '  Hooks can run outside the sandbox after you trust them.',
  '› 1. Review hooks',
  '  2. Trust all and continue',
  "  3. Continue without trusting (hooks won't run)",
  '  enter confirm · esc skip',
];

/** The same hooks review with its selection moved down to `2`, no return pressed yet: a capture. */
export const CODEX_HOOKS_REVIEW_ON_TWO = [
  '  Hooks need review',
  '  1 hook is new or changed.',
  '  Hooks can run outside the sandbox after you trust them.',
  '  1. Review hooks',
  '› 2. Trust all and continue',
  "  3. Continue without trusting (hooks won't run)",
  '  enter confirm · esc skip',
];

/** The count row of the captured hooks review, which says how many hooks the review covers. */
const HOOKS_COUNT_ROW = '  1 hook is new or changed.';

/**
 * A hooks review, `rows` (CODEX_HOOKS_REVIEW or CODEX_HOOKS_REVIEW_ON_TWO), with
 * its count row saying `count` hooks, as Codex writes it: `1 hook is new or
 * changed.`, or `N hooks are new or changed.` (#506, the brief's wording). The
 * other rows are the captured ones, unchanged. A reconstruction for any count
 * but 1.
 */
export const codexHooksReview = (count, rows = CODEX_HOOKS_REVIEW) => rows.map((row) => (row === HOOKS_COUNT_ROW
  ? `  ${count === 1 ? '1 hook is' : `${count} hooks are`} new or changed.`
  : row));

/**
 * The review a fresh Codex bot's two kit hooks bring up (SessionStart, Stop;
 * the PostToolUse Bash nudge hook went with #555), none of them trusted yet:
 * a reconstruction.
 */
export const CODEX_HOOKS_REVIEW_TWO = codexHooksReview(2);

/** The same, its selection moved down to `2`, no return pressed yet: a reconstruction. */
export const CODEX_HOOKS_REVIEW_TWO_ON_TWO = codexHooksReview(2, CODEX_HOOKS_REVIEW_ON_TWO);

/** The captured hooks review with its count row taken out: a reconstruction (#506). */
export const CODEX_HOOKS_REVIEW_NO_COUNT = CODEX_HOOKS_REVIEW.filter((row) => row !== HOOKS_COUNT_ROW);

/**
 * Claude Code 2.1.283's folder-trust list, its selection on `No, exit`, its
 * choices unnumbered: a capture, the whole `tail` of a kit-made tab. Above it,
 * the launch line the kit typed, wrapped where the screen is 120 columns wide,
 * and the mailbox step's answer. Not a question by the numbered rule at the
 * top; see CLAUDE_TRUST_AS_ORCA_SAW_IT for why the kit types nothing into it
 * all the same. The system tests' look counts it by its foot row.
 */
export const CLAUDE_TRUST = [
  '➜  bot-father git:(main) ✗ <kit clone>/src/cli.js ses',
  'sion mailbox --bots <tmp>/obk-system-question-Xygmnk --bot bot-father',
  ' --session daily; OBK_TAB_SHELL=$$ OBK_CLI=<kit clone>',
  '/src/cli.js claude --permission-mode auto -n bot-father.daily.9r9v3vg3',
  'bot-father/daily has its mailbox run_1774b8ba625f, made in this tab.',
  '─'.repeat(120),
  ' Accessing workspace:',
  ' <tmp>/obk-system-question-Xygmnk/bots/bot-father',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
  ' project, or work from your team). If not, take a moment to review what\'s in this folder first.',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  ' Security guide',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  ' Enter to confirm · Esc to cancel',
];

/**
 * What Orca said about the tab CLAUDE_TRUST was captured in, as the fake Orca's
 * state: its wait timed out, as on a harness at work, and it named no agent in
 * the tab (both seen live, for minutes).
 */
export const CLAUDE_TRUST_AS_ORCA_SAW_IT = { waitIdle: 'busy', agentIdentity: null };

/**
 * Claude Code offering to learn the machine: the question and its three
 * numbered choices are in the tech notes (verified live on 2.1.278). Where the
 * selection starts is not recorded, and the layout follows CLAUDE_TRUST's. A
 * reconstruction.
 */
export const CLAUDE_TEACH_AUTO = [
  '',
  ' Teach auto mode about your environment?',
  '',
  ' ❯ 1. Yes',
  '   2. Not now',
  "   3. Don't show again",
  '',
];

/**
 * Claude Code 2.1.283's "Teach auto mode about your environment?", a form with
 * no numbers, its selection on "Also scan shell history", drawn under a rule of
 * `▔` right after the session's first turn: a capture, the whole `tail` of a
 * kit-made tab in #261's live test, 2026-09-28, in auto mode. Enter on it is
 * Continue, which starts a scan of the project, recent Claude sessions and, as
 * it stands, the shell history (#416). `<tmp>` stands for the system temp
 * folder, in full on the wrapped rows and in Claude Code's own shortening on
 * the third; the rows were not wrapped again.
 */
export const CLAUDE_TEACH_FORM = [
  ' ▐▛███▛█   Claude Code v2.1.283',
  '▝▜██████▀  Opus 5.5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-system-node-nudge-XX7Vtx/bots/node-nudge · /rc',
  '❯ You are a system test\'s bot and you own nothing. Your bots folder is',
  '  <tmp>/obk-system-node-nudge-XX7Vtx. Do nothing that is not written',
  '  here: read no file and write nothing. Reply now with READY-3917 and nothing else. When a line arrives saying fleet',
  '  mail is waiting, run exactly the command that line names to read it, and then print MAIL: followed by the text of the',
  '  message. When you are asked to write something out, do exactly that. Otherwise say nothing and wait.',
  '⏺ READY-3917',
  '✻ Churned for 1s · done 5:42 AM',
  '▔'.repeat(120),
  '   Teach auto mode about your environment?',
  '   Claude Code reads this project, your recent Claude sessions, and optionally your shell history and other',
  '   repositories. Claude analyzes this data and customizes auto mode to make better decisions.',
  '     How you use Claude here     Mixed',
  '   ❯ Also scan shell history     true',
  '     Also scan your other repos  false',
  '     Continue',
  '   ←/→ to change usage · Enter to continue · Esc to cancel',
];

/**
 * The same form with its selection moved down to Continue, the row a return
 * takes: a reconstruction, CLAUDE_TEACH_FORM with the pointer moved.
 */
export const CLAUDE_TEACH_FORM_ON_CONTINUE = CLAUDE_TEACH_FORM.map((row) => {
  if (row === '   ❯ Also scan shell history     true') return '     Also scan shell history     true';
  if (row === '     Continue') return '   ❯ Continue';
  return row;
});

/**
 * Claude Code 2.1.289's "Teach auto mode about your environment?", a numbered
 * list this time, its selection on "1. Yes", drawn above the input box right
 * after the session's first turn: a capture, the whole `tail` of a kit-made
 * temporary session's tab in #489's live run, 2026-10-05, in auto mode. Enter
 * on it takes the row the pointer is on; its answer is "2. Not now" (#489).
 * The input box below it keeps its own `❯`. `<tmp>` stands for the system temp
 * folder, in full on the wrapped rows and in Claude Code's own shortening on
 * the third; the rows were not wrapped again.
 */
export const CLAUDE_TEACH_LIST = [
  ' ▐▛███▛█   Claude Code v2.1.289',
  '▝▜██████▀  Opus 5.5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-system-temp-answer-8k20ct/bots/answer-bot · /rc',
  '❯ You are a system test\'s session and you own nothing. Do not run any command, read or write any file, or use any tool.',
  '  Reply now with READY-4893 and nothing else, then wait.',
  '  Your work dir is',
  '  <tmp>/obk-system-temp-answer-8k20ct/bots/answer-bot/work/helper.',
  '  It is a plain folder the kit made for you, not a git worktree.',
  '⏺ READY-4893',
  '✻ Baked for 1s · done 3:15 AM',
  '─'.repeat(120),
  '  Teach auto mode about your environment?',
  '  Auto mode works better when it knows your environment. Takes about a minute.',
  '  ❯ 1. Yes',
  '    2. Not now',
  '    3. Don\'t show again',
  '  Enter to confirm · Esc to cancel',
  `${'─'.repeat(91)} answer-bot.helper.vm2yc5b2 ─`,
  '❯',
  '─'.repeat(120),
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
];

/** CLAUDE_TEACH_LIST with its selection on `choice`, one of its three rows: a reconstruction. */
const teachListOn = (choice) => CLAUDE_TEACH_LIST.map((row) => {
  const found = /^ {2}(?:❯ | {2})([123]\. .+)$/.exec(row);
  if (found === null) return row;
  return found[1] === choice ? `  ❯ ${found[1]}` : `    ${found[1]}`;
});

/** The same list with its selection moved down to "2. Not now", no return pressed yet: a reconstruction. */
export const CLAUDE_TEACH_LIST_ON_NOT_NOW = teachListOn('2. Not now');

/** The same list with its selection on "3. Don't show again": a reconstruction. */
export const CLAUDE_TEACH_LIST_ON_THREE = teachListOn('3. Don\'t show again');

/**
 * Not a question: the model's answer holds an ordinary numbered list, with no
 * pointer on it, and the empty input line is below. A reconstruction on the
 * captured input line.
 */
export const NUMBERED_ANSWER = [
  '❯ What is left to do on this issue?',
  '⏺ Three things are left:',
  '  1. Write the tests for the fake',
  '  2. Run them and read the failures',
  '  3. Hand them to the implementer',
  ...CLAUDE_INPUT_LINE,
];

/**
 * Not a question: a question-shaped block that is history, pointer and numbers
 * and all, with the input line back below it. Here the model quotes Codex's
 * update offer, the way a bot working on issue #329 has it on its screen for
 * hours. A reconstruction on the captured input line.
 */
export const QUESTION_IN_HISTORY = [
  '❯ What did Codex show when it updated itself?',
  '⏺ Its update offer, as issue #329 quotes it:',
  '  ✨ Update available! 0.156.1 -> 0.157.1',
  "  › 1. Update now (runs `sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | … sh'`)",
  '    2. Skip',
  '    3. Skip until next version',
  '  The line typed with a return took the default.',
  ...CLAUDE_INPUT_LINE,
];

/**
 * Not a question: the teach form's own words, title, pointer and foot row, are
 * history, quoted by the model the way a bot working on issue #416 has them on
 * its screen, with the input line back below. A reconstruction on the
 * captured input line.
 */
export const FORM_IN_HISTORY = [
  '❯ What did Claude Code show after the first turn?',
  '⏺ Its form to teach auto mode, as issue #416 quotes it:',
  '     Teach auto mode about your environment?',
  '     How you use Claude here     Mixed',
  '     ❯ Also scan shell history     true',
  '       Continue',
  '     ←/→ to change usage · Enter to continue · Esc to cancel',
  '  Enter on it is Continue, which starts the scan.',
  ...CLAUDE_INPUT_LINE,
];

/**
 * CLAUDE_TEACH_LIST once the list has gone: the capture with the rule above
 * the list's title and the list's rows down to its foot taken out, the
 * answered turn and the input box left as captured. Not a question. A
 * reconstruction: what Claude Code 2.1.289 draws once the list is answered
 * was not captured (#491).
 */
export const CLAUDE_TEACH_LIST_GONE = CLAUDE_TEACH_LIST.filter((row, at) => {
  const title = CLAUDE_TEACH_LIST.findIndex((one) => one.trim() === 'Teach auto mode about your environment?');
  const foot = CLAUDE_TEACH_LIST.findIndex((one) => one.trim() === 'Enter to confirm · Esc to cancel');
  return at < title - 1 || at > foot;
});

/**
 * CLAUDE_TEACH_LIST with one blank row between its foot and the input box's
 * top rule: a question. A reconstruction: no such layout was seen, but
 * Claude Code may leave a blank row under a list it draws (#491).
 */
export const CLAUDE_TEACH_LIST_BLANK_UNDER = CLAUDE_TEACH_LIST.flatMap((row) => (
  row.trim() === 'Enter to confirm · Esc to cancel' ? [row, ''] : [row]
));

/**
 * CLAUDE_TEACH_LIST with its foot taken out and one blank row between its
 * last numbered choice and the input box's top rule: a question by its
 * numbered choices and pointer alone. A reconstruction, as above (#491).
 */
export const CLAUDE_TEACH_LIST_NO_FOOT_BLANK_UNDER = CLAUDE_TEACH_LIST.flatMap((row) => {
  if (row.trim() === 'Enter to confirm · Esc to cancel') return [];
  return row === '    3. Don\'t show again' ? [row, ''] : [row];
});

/**
 * CLAUDE_TEACH_LIST in a narrow pane: its foot row wrapped onto two rows,
 * "  Enter to confirm ·" and "  Esc to cancel", right above the input box's
 * top rule; every other row as captured. A question. A reconstruction (#491,
 * from review): no narrow pane was captured, and where the foot breaks is
 * made up here.
 */
export const CLAUDE_TEACH_LIST_FOOT_WRAPPED = CLAUDE_TEACH_LIST.flatMap((row) => (
  row.trim() === 'Enter to confirm · Esc to cancel' ? ['  Enter to confirm ·', '  Esc to cancel'] : [row]
));

/**
 * Not a question: CLAUDE_TEACH_LIST's own rows, title, pointer, numbers and
 * foot, are history, quoted by the model the way a bot working on issue #491
 * has them on its screen, a conversation row after them and the input line
 * back below. A reconstruction on the captured input line (#491).
 */
export const LIST_IN_HISTORY = [
  '❯ What did Claude Code 2.1.289 show after the first turn?',
  '⏺ Its Teach list, above the input box, as issue #491 quotes it:',
  '    Teach auto mode about your environment?',
  '    Auto mode works better when it knows your environment. Takes about a minute.',
  '    ❯ 1. Yes',
  '      2. Not now',
  '      3. Don\'t show again',
  '    Enter to confirm · Esc to cancel',
  '  A return on it takes "1. Yes", which starts the teach scan.',
  ...CLAUDE_INPUT_LINE,
];

/**
 * Not a question: the user's past turn, a numbered list of its own, echoed
 * with Claude Code's pointer on its first row and the second lined up under
 * it, the model's answer after it and the input line back below. A
 * reconstruction on the captured input line, its echo laid out as
 * CLAUDE_ANSWERED wraps a long turn (#491).
 */
export const NUMBERED_TURN_ECHOED = [
  '❯ 1. Write the tests for the fake',
  '  2. Run them and read the failures',
  '⏺ Both are done: the tests are in test/fake.test.js, and they fail as expected.',
  '✻ Cooked for 1s · done 4:14 AM',
  ...CLAUDE_INPUT_LINE,
];

// Claude Code's panel of feedback drafts (#502). Claude Code can draft feedback
// about itself and show the drafts in a rounded box (╭ ╮ │ ╰ ╯), drawn as the
// last thing right above its input box's top rule. Inside, the first row is
// `✻ <Label> drafted: <title>`, the label one of "Bug report", "Product
// feedback", "Feature request", or "Feedback"; then a few dimmed preview
// rows; then a foot. While the panel is open the slash menu does not come up,
// and the panel takes single keys from the input line: `1` opens review, `2`
// and `2` again sends a draft to Anthropic, `0` dismisses. After a `0` Claude
// Code may ask instead, with no box and no title row, "Turn off Claude-drafted
// feedback? 0 to turn off · Esc to keep", and a typed line answers that too.
// It draws nothing of the panel while a turn is running. The words are Claude
// Code 2.1.291's own, as the arch-panel architect read them for #502; only the
// first screen below is a capture.

/**
 * The panel open above Claude Code's input box, `/compact` typed into the
 * input line and not entered, and the rows of the slash menu above the panel:
 * a capture. It is the end of the screen as the kit's refusal of a compact
 * quoted it, in arch-panel's architect session on 2026-10-07, passed on by
 * Bot Father (#502): the last twelve rows that were not blank, each with its
 * trailing spaces cut off, split where the refusal joined them with " ⏎ ".
 * The rows above them were not quoted. Its foot is the panel's at rest, with
 * three more drafts queued.
 */
export const CLAUDE_FEEDBACK_PANEL_TYPED = [
  '  /autocompact                                             Set how full the context gets before auto-summarizing',
  '  /computer-use                                            Read this skill before the first step of any request to do something in an app on the person\'s own computer (Notes,',
  '                                                           Finder, System Settings, any desktop app), to look at their screen, or for "computer use". Computer use (desktop con…',
  `╭${'─'.repeat(161)}╮`,
  '│ ✻ Bug report drafted: Auto-mode classifier refused owner-approved routine steps (self-merge follow-up, recording owner\'s words)                                 │',
  '│ │ - What happened: In auto mode, two routine steps were refused. (1) "[Self-Approval]": after the session merged its own spec PR (owner had chosen the exact n… │',
  '│ 1 to review · 2 to send · 0 to dismiss · +3 more queued                                                                                                         │',
  `╰${'─'.repeat(161)}╯`,
  `${'─'.repeat(146)} arch-panel.architect.htm4ra2v ─`,
  '❯\u00a0/compact',
  '─'.repeat(178),
  '  ⏵⏵ auto mode on (shift+tab to cycle) · 4 feedback drafts',
];

/** CLAUDE_FEEDBACK_PANEL_TYPED from the top of the panel's box down: the slash menu's rows above it taken out. */
const FEEDBACK_PANEL_DOWN = CLAUDE_FEEDBACK_PANEL_TYPED.slice(CLAUDE_FEEDBACK_PANEL_TYPED.findIndex((row) => row.startsWith('╭')));

/**
 * The panel open above Claude Code's empty input line, as the kit finds it
 * before it types: the capture with the slash menu's rows above the panel
 * taken out and `/compact` taken out of the input line, which keeps its
 * pointer and the non-breaking space after it. A reconstruction: the screen
 * with the input line empty was not captured.
 */
export const CLAUDE_FEEDBACK_PANEL = FEEDBACK_PANEL_DOWN.map((row) => (row === '❯ /compact' ? '❯ ' : row));

/**
 * CLAUDE_FEEDBACK_PANEL once the drafts are dealt with: the panel's box taken
 * out, and " · 4 feedback drafts" taken out of the status row, every other
 * row as it was. No panel. A reconstruction: what Claude Code draws once the
 * drafts are gone was not captured.
 */
export const CLAUDE_FEEDBACK_PANEL_GONE = CLAUDE_FEEDBACK_PANEL
  .filter((row) => !/^[╭│╰]/.test(row))
  .map((row) => row.replace(' · 4 feedback drafts', ''));

/**
 * After a `0`: Claude Code's question whether to turn its drafts off, on one
 * row in the place of the box, right above the input box's top rule, every
 * other row as in CLAUDE_FEEDBACK_PANEL. A typed line answers it, so it counts
 * as the panel. A reconstruction: the words are Claude Code 2.1.291's, the
 * layout (one row, two spaces in) is made up.
 */
export const CLAUDE_FEEDBACK_TURN_OFF = CLAUDE_FEEDBACK_PANEL.flatMap((row) => {
  if (row.startsWith('╭')) return ['  Turn off Claude-drafted feedback? 0 to turn off · Esc to keep'];
  return /^[│╰]/.test(row) ? [] : [row];
});

/**
 * Not the panel: the captured panel's box, row for row, in the history, the
 * way a bot working on issue #502 has it on its screen, with a turn after it
 * (the user's next line and the model's answer) and the empty input box back
 * below. A reconstruction on the captured input line.
 */
export const FEEDBACK_PANEL_IN_HISTORY = [
  '❯ What did Claude Code draw above its input box?',
  '⏺ Its panel of feedback drafts, as issue #502 quotes it:',
  ...FEEDBACK_PANEL_DOWN.filter((row) => /^[╭│╰]/.test(row)),
  '❯ Leave the drafts to the owner and go on with the issue.',
  '⏺ I will leave them alone.',
  '✻ Cooked for 1s · done 4:14 AM',
  ...CLAUDE_INPUT_LINE,
];

/**
 * Not the panel: the question to turn the drafts off, quoted in the history,
 * a row of the model's answer after it and the empty input box back below. A
 * reconstruction on the captured input line.
 */
export const FEEDBACK_TURN_OFF_IN_HISTORY = [
  '❯ What did Claude Code ask after the drafts were dismissed?',
  '⏺ It asked, right above its input box:',
  '  Turn off Claude-drafted feedback? 0 to turn off · Esc to keep',
  '  A typed line would answer it, so the kit typed nothing.',
  ...CLAUDE_INPUT_LINE,
];

// A harness's own command typed into its input line and not entered yet, and
// a harness at work (#391). Where a screen is a live capture it says so; the
// rest are reconstructions on the captured CLAUDE_ANSWERED or CODEX_ANSWERED,
// with the rows around the command made up here on the layout live run 4
// showed.

/** Claude Code's screen down to its input box: CLAUDE_ANSWERED's header, its answered turn. */
const CLAUDE_ABOVE_INPUT = CLAUDE_ANSWERED.slice(0, 7);

// Claude Code 2.1.288, as live run 4 of #391 showed it: the input line puts a
// non-breaking space (U+00A0) after its pointer, `❯\u00a0/clear`; the slash
// menu is drawn ABOVE the input box's top rule, one command a row, a long
// description wrapped onto a row of its own lined up under the description,
// and no pointer marks a selection. With "/" alone typed, the menu showed only
// part of the list. Orca's tui-idle stayed ok with the menu open. The rules
// were relayed shortened ("──────…──"); here they are drawn full width, as in
// the captures above.

/** The top rule of the live run's Claude bot's input box, carrying its session's name. */
const CLAUDE_LIVE_RULE = `${'─'.repeat(92)} clear-claude.daily.drqpadex ─`;

/** Its bottom rule. */
const CLAUDE_RULE = '─'.repeat(120);

/** Its foot row, as live run 4 showed it. */
const CLAUDE_LIVE_FOOT = '  ⏵⏵ auto mode on (shift+tab to cycle)';

/** Claude Code 2.1.288 with `menu` drawn above its input box and `input` as its input line. */
const claudeMenuAbove = (menu, input) => [...CLAUDE_ABOVE_INPUT, ...menu, CLAUDE_LIVE_RULE, input, CLAUDE_RULE, CLAUDE_LIVE_FOOT];

/** Claude Code's input line reading `text`, with the non-breaking space after its pointer, as 2.1.288 draws it. */
const claudeInput = (text) => `❯\u00a0${text}`;

/** Claude Code's menu rows for `/clear`, word for word as live run 4 showed them: the command, its description wrapped. */
const CLAUDE_CLEAR_ROWS = [
  '  /clear                                          Start a new session with empty context; previous session stays on',
  '                                                  disk (resumable with /resume)',
];

/** Claude Code's menu row for `/compact`, laid out as /clear's; the words are made up. */
const CLAUDE_COMPACT_ROWS = ['  /compact                                        Clear conversation history but keep a summary in context'];

/** Claude Code's menu rows for "/" alone, part of the list as live run 4 showed it; the descriptions are made up. */
const CLAUDE_SLASH_ROWS = [
  '  /systematic-validation                          Validate code or docs against explicit design docs, requirements,',
  '                                                  test specs, CLAUDE.md, or AGENTS.md standards',
  '  /claude-api                                     Reference for the Claude API / Anthropic SDK: model ids, pricing,',
  '                                                  params, streaming, tool use',
];

/**
 * `/clear` typed into Claude Code 2.1.288's empty input line, its menu above
 * the box with `/clear` its first and only command row. From the menu down, a
 * live capture (live run 4 of #391), the rules drawn full width; the header
 * above is CLAUDE_ANSWERED's.
 */
export const CLAUDE_CLEAR_TYPED = claudeMenuAbove(CLAUDE_CLEAR_ROWS, claudeInput('/clear'));

/**
 * `/clear` typed after a draft that was already in the input line, so the line
 * reads the draft and the command together; the menu above is drawn as for the
 * command alone, so only the input line is wrong. A reconstruction.
 */
export const CLAUDE_CLEAR_AFTER_DRAFT = claudeMenuAbove(CLAUDE_CLEAR_ROWS, claudeInput('fix the flaky test/clear'));

/**
 * `/clear` typed, and the menu's first command row above the box a command
 * whose name only starts with it, `/clear` itself second. A reconstruction: no
 * such command was seen.
 */
export const CLAUDE_CLEAR_OTHER_FIRST = claudeMenuAbove([
  '  /clear-history                                  Remove the prompt history',
  ...CLAUDE_CLEAR_ROWS,
], claudeInput('/clear'));

/** `/clear` typed, and no menu at all above the input box: its foot row under it as when idle. A reconstruction. */
export const CLAUDE_CLEAR_NO_MENU = claudeMenuAbove([], claudeInput('/clear'));

/**
 * `/clear` typed, and the menu drawn UNDER the input box, none above it: the
 * layout the kit read before live run 4, which Claude Code 2.1.288 does not
 * draw. A reconstruction.
 */
export const CLAUDE_CLEAR_MENU_BELOW = [...CLAUDE_ABOVE_INPUT, CLAUDE_LIVE_RULE, claudeInput('/clear'), CLAUDE_RULE, ...CLAUDE_CLEAR_ROWS];

/** `/compact` typed into Claude Code's empty input line, its menu above with `/compact` first. A reconstruction on the live layout. */
export const CLAUDE_COMPACT_TYPED = claudeMenuAbove(CLAUDE_COMPACT_ROWS, claudeInput('/compact'));

/**
 * `/compact` typed, its input line `❯` alone, and Claude Code 2.1.288's menu
 * above the box with `/compact` its first and only command row, no pointer in
 * it (#510). A reconstruction.
 */
export const CLAUDE_COMPACT_BARE = claudeMenuAbove(CLAUDE_COMPACT_ROWS, '❯');

/** The same for `/clear`: its input line `❯` alone under CLAUDE_CLEAR_TYPED's menu. A reconstruction. */
export const CLAUDE_CLEAR_BARE = claudeMenuAbove(CLAUDE_CLEAR_ROWS, '❯');

/**
 * `/compact` typed and shown in the input line, and Claude Code 2.1.288's menu
 * above the box with no pointer and `/autocompact` its first command row,
 * `/compact` second: the screen's only `❯ /compact` is the input line's
 * (#510). A reconstruction: `/autocompact`'s words are 2.1.296's, laid out as
 * 2.1.288 lays out its rows.
 */
export const CLAUDE_COMPACT_OTHER_FIRST = claudeMenuAbove([
  `${'  /autocompact'.padEnd(50)}Set how full the context gets before auto-summarizing`,
  ...CLAUDE_COMPACT_ROWS,
], claudeInput('/compact'));

// Claude Code 2.1.296, as live probes for #510 showed it on 2026-10-09 in
// Orca 1.4.223, in throwaway sessions not made by the kit, so their rules
// carry no session name. With a command typed one character a send, the slash
// menu above the input box's top rule marks its selected row with a pointer
// and a plain space, `  ❯ /compact`; the other rows are set two columns
// further in, and a wrapped description is lined up under the descriptions.
// The input line under the rule reads `❯` alone, whatever is in it. Orca's
// read gives the line's text apart from the rows, as `draft`, and leaves the
// key out when the line is empty; its help calls it "UI-only composer text
// excluded from tail". A read with a draft is `{ screen, draft }` here, as the
// fake Orca's `nextScreens` takes it.
//
// The first probe read a session with no turn yet, the second and the fourth
// one after a turn. Each screen was the same 300 ms, 1 s and 3 s after the
// last character. Only the fourth probe saved `draft`, so an earlier capture
// paired with a draft is a rebuilt pairing, and says so. Each capture is the
// whole `tail` of one read, the probe's folder put back to `<tmp>` and nothing
// else changed. The reconstructions stand on the fourth probe's captures.

/** Claude Code 2.1.296 at its idle input line, showing its placeholder, before anything was typed: a capture. */
export const CLAUDE_296_IDLE = [
  ' ▐▛███▛█   Claude Code v2.1.296',
  '▝▜██████▀  Opus 5.5 · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-probe-510.DwlBk4',
  '▎ Auto mode is now Claude Code\'s default permission mode.',
  '▎ Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for risky actions and',
  '▎ prompt injection before executing, runs the ones it assesses as lower-risk, and blocks the rest.',
  '▎ https://code.claude.com/docs/en/permission-modes',
  '                                                                                                    ◐ medium · /effort',
  '─'.repeat(120),
  '❯\u00a0Try "edit <filepath> to..."',
  '─'.repeat(120),
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
];

/**
 * `/compact` typed into Claude Code 2.1.296: its menu above the box with the
 * pointer on `/compact`, `/autocompact` and `/computer-use` under it, and the
 * input line `❯` alone. A capture from the first probe, which saved the rows
 * and not the draft.
 */
export const CLAUDE_296_COMPACT_TYPED = [
  ' ▐▛███▛█   Claude Code v2.1.296',
  '▝▜██████▀  Opus 5.5 · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-probe-510.DwlBk4',
  '▎ Auto mode is now Claude Code\'s default permission mode.',
  '▎ Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for risky actions and',
  '▎ prompt injection before executing, runs the ones it assesses as lower-risk, and blocks the rest.',
  '▎ https://code.claude.com/docs/en/permission-modes',
  '  ❯ /compact                                        Free up context by summarizing the conversation so far',
  '    /autocompact                                    Set how full the context gets before auto-summarizing',
  '    /computer-use                                   Read this skill before the first step of any request to do',
  '                                                    something in an app on the person\'s own computer (Notes, Finder, …',
  '─'.repeat(120),
  '❯',
  '─'.repeat(120),
  '  ⏵⏵ auto mode on (shift+tab to cycle)',
];

/**
 * `/clear` typed into Claude Code 2.1.296: its menu above the box with the
 * pointer on `/clear`, its only command row, and the input line `❯` alone. A
 * capture from the first probe, which saved the rows and not the draft.
 */
export const CLAUDE_296_CLEAR_TYPED = [
  ' ▐▛███▛█   Claude Code v2.1.296',
  '▝▜██████▀  Opus 5.5 · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-probe-510.DwlBk4',
  '▎ Auto mode is now Claude Code\'s default permission mode.',
  '▎ Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for risky actions and',
  '▎ prompt injection before executing, runs the ones it assesses as lower-risk, and blocks the rest.',
  '▎ https://code.claude.com/docs/en/permission-modes',
  '  ❯ /clear                                          Start a new session with empty context; previous session stays on',
  '                                                    disk (resumable with /resume)',
  '─'.repeat(120),
  '❯',
  '─'.repeat(120),
  '  ⏵⏵ auto mode on (shift+tab to cycle)',
];

/**
 * `/compact` typed into Claude Code 2.1.296 with no turn yet, read with its
 * draft: CLAUDE_296_COMPACT_TYPED with `draft: '/compact'` beside it. A
 * rebuilt pairing: the first probe saved the rows and not the draft.
 */
export const CLAUDE_296_COMPACT_READ = { screen: CLAUDE_296_COMPACT_TYPED, draft: '/compact' };

/** The same for `/clear`: CLAUDE_296_CLEAR_TYPED with `draft: '/clear'` beside it. A rebuilt pairing. */
export const CLAUDE_296_CLEAR_READ = { screen: CLAUDE_296_CLEAR_TYPED, draft: '/clear' };

/**
 * `/clear` typed into Claude Code 2.1.296 after one turn, at the kit's pace:
 * its menu above the box with the pointer on `/clear`, and the input line `❯`
 * alone. A capture from the second probe, which saved the rows and not the
 * draft.
 */
export const CLAUDE_296_TURN_CLEAR_TYPED = [
  ' ▐▛███▛█   Claude Code v2.1.296',
  '▝▜██████▀  Opus 5.5 · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-probe-510b.pbX1Oa',
  '❯ Reply with the single word ok, and do nothing else.',
  '⏺ ok',
  '✻ Worked for 1s · done 8:24 PM',
  '  ❯ /clear                                          Start a new session with empty context; previous session stays on',
  '                                                    disk (resumable with /resume)',
  '─'.repeat(120),
  '❯',
  '─'.repeat(120),
  '  ⏵⏵ auto mode on (shift+tab to cycle)',
];

/** CLAUDE_296_TURN_CLEAR_TYPED with `draft: '/clear'` beside it. A rebuilt pairing. */
export const CLAUDE_296_TURN_CLEAR_READ = { screen: CLAUDE_296_TURN_CLEAR_TYPED, draft: '/clear' };

// The fourth probe saved Orca's whole answer to each read, `draft` with the
// rows, in a session after one turn.

/**
 * Claude Code 2.1.296 after one turn, its input line empty, which reads `❯`
 * alone: a capture, a read with no draft. The read after a typed line was
 * taken back with backspaces gave the same rows, with no draft.
 */
export const CLAUDE_296_TURN_IDLE = [
  ' ▐▛███▛█   Claude Code v2.1.296',
  '▝▜██████▀  Opus 5.5 · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-probe-510d.LVfL3G',
  '❯ Reply with the single word ok, and do nothing else.',
  '⏺ ok',
  '✻ Cooked for 1s · done 8:30 PM',
  '─'.repeat(120),
  '❯',
  '─'.repeat(120),
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
];

/**
 * A draft, `hello`, typed into the empty input line after that turn: the line
 * still reads `❯` alone, and the draft comes beside the rows. A capture, the
 * rows and the draft from one read.
 */
export const CLAUDE_296_TURN_DRAFT = {
  screen: [
    ' ▐▛███▛█   Claude Code v2.1.296',
    '▝▜██████▀  Opus 5.5 · Claude Max',
    ' ▝▝   ▝▝   <tmp>/obk-probe-510d.LVfL3G',
    '❯ Reply with the single word ok, and do nothing else.',
    '⏺ ok',
    '✻ Cooked for 1s · done 8:30 PM',
    '─'.repeat(120),
    '❯',
    '─'.repeat(120),
    '  ⏵⏵ auto mode on (shift+tab to cycle)',
  ],
  draft: 'hello',
};

/**
 * `/compact` typed after that draft: no menu came up, and the draft reads
 * `hello/compact`. A capture: the read gave the same rows as
 * CLAUDE_296_TURN_DRAFT's, and this draft.
 */
export const CLAUDE_296_TURN_DRAFT_COMPACT = { screen: CLAUDE_296_TURN_DRAFT.screen, draft: 'hello/compact' };

/**
 * `/compact` typed into the empty input line after that turn: the menu above
 * the box with the pointer on `/compact`, the input line `❯` alone, and the
 * draft `/compact`. A capture, the rows and the draft from one read.
 */
export const CLAUDE_296_TURN_COMPACT = {
  screen: [
    ' ▐▛███▛█   Claude Code v2.1.296',
    '▝▜██████▀  Opus 5.5 · Claude Max',
    ' ▝▝   ▝▝   <tmp>/obk-probe-510d.LVfL3G',
    '❯ Reply with the single word ok, and do nothing else.',
    '⏺ ok',
    '✻ Cooked for 1s · done 8:30 PM',
    '  ❯ /compact                                        Free up context by summarizing the conversation so far',
    '    /autocompact                                    Set how full the context gets before auto-summarizing',
    '    /computer-use                                   Read this skill before the first step of any request to do',
    '                                                    something in an app on the person\'s own computer (Notes, Finder, …',
    '─'.repeat(120),
    '❯',
    '─'.repeat(120),
    '  ⏵⏵ auto mode on (shift+tab to cycle)',
  ],
  draft: '/compact',
};

/** The rows of CLAUDE_296_TURN_COMPACT, the reconstructions below stand on. */
const TURN_COMPACT_ROWS = CLAUDE_296_TURN_COMPACT.screen;

/** Where the menu starts there: right under the answered turn. */
const CLAUDE_296_MENU_AT = TURN_COMPACT_ROWS.findIndex((row) => row.startsWith('  ❯ /compact'));

/** The screen above the menu: Claude Code's header and the answered turn. */
const CLAUDE_296_ABOVE_MENU = TURN_COMPACT_ROWS.slice(0, CLAUDE_296_MENU_AT);

/** The menu rows with `/compact` typed, as captured: the pointer on `/compact`. */
const CLAUDE_296_COMPACT_MENU = TURN_COMPACT_ROWS.slice(CLAUDE_296_MENU_AT, TURN_COMPACT_ROWS.findIndex((row) => row.startsWith('─')));

/** The menu rows with `/clear` typed, as the second probe captured them: the pointer on `/clear`. */
const CLAUDE_296_CLEAR_MENU = CLAUDE_296_TURN_CLEAR_TYPED.slice(CLAUDE_296_MENU_AT, CLAUDE_296_TURN_CLEAR_TYPED.findIndex((row) => row.startsWith('─')));

/** The input box's rule, and the foot under it with a command typed, as captured. */
const CLAUDE_296_RULE = '─'.repeat(120);
const CLAUDE_296_FOOT = '  ⏵⏵ auto mode on (shift+tab to cycle)';

/** CLAUDE_296_TURN_COMPACT's rows with `menu` drawn above the input box and `input` as the input line. */
const claude296 = (menu, input) => [...CLAUDE_296_ABOVE_MENU, ...menu, CLAUDE_296_RULE, input, CLAUDE_296_RULE, CLAUDE_296_FOOT];

/** A 2.1.296 menu row with its pointer taken off: the two columns it and its space took are spaces again. */
const unselected = (row) => row.replace(/^ {2}❯ /, '    ');

/** A 2.1.296 menu row with the pointer put on it, in the two columns before its command. */
const selected = (row) => row.replace(/^ {4}\//, '  ❯ /');

/**
 * `/compact` typed, the menu's pointer on it, and the input line showing the
 * text, `❯ /compact`, with no draft: CLAUDE_296_TURN_COMPACT's rows with only
 * the input line changed, and its draft left out. A reconstruction: no live
 * read showed this line.
 */
export const CLAUDE_296_COMPACT_SHOWN = TURN_COMPACT_ROWS.map((row) => (row === '❯' ? claudeInput('/compact') : row));

/** The same for `/clear`: CLAUDE_296_TURN_CLEAR_TYPED with only its input line changed, to `❯ /clear`, and no draft. A reconstruction. */
export const CLAUDE_296_CLEAR_SHOWN = CLAUDE_296_TURN_CLEAR_TYPED.map((row) => (row === '❯' ? claudeInput('/clear') : row));

/**
 * `/compact` typed after a draft the kit could not see before its first key:
 * CLAUDE_296_TURN_COMPACT's rows as captured, the menu's pointer on
 * `/compact`, and the draft `x/compact`. A reconstruction: only the draft
 * changed; no live read showed it.
 */
export const CLAUDE_296_COMPACT_OTHER_DRAFT = { screen: TURN_COMPACT_ROWS, draft: 'x/compact' };

/** The same for `/clear`: CLAUDE_296_TURN_CLEAR_TYPED's rows as captured, the pointer on `/clear`, and the draft `x/clear`. A reconstruction. */
export const CLAUDE_296_CLEAR_OTHER_DRAFT = { screen: CLAUDE_296_TURN_CLEAR_TYPED, draft: 'x/clear' };

/**
 * The draft `/compact`, and the menu's pointer moved down onto
 * `/autocompact`: `/compact` is the first command row, not selected. A
 * reconstruction from CLAUDE_296_TURN_COMPACT: only the pointer moved.
 */
export const CLAUDE_296_ON_AUTOCOMPACT = {
  screen: claude296(CLAUDE_296_COMPACT_MENU.map((row) => {
    if (row.startsWith('  ❯ /compact ')) return unselected(row);
    if (row.startsWith('    /autocompact ')) return selected(row);
    return row;
  }), '❯'),
  draft: '/compact',
};

/**
 * The draft `/compact`, and the menu's pointer on a command whose name only
 * starts with it, `/compact-x`, drawn first; `/compact` under it, not
 * selected, then the captured rows. A reconstruction from
 * CLAUDE_296_TURN_COMPACT: no `/compact-x` was seen, and its words are made up.
 */
export const CLAUDE_296_ON_COMPACT_X = {
  screen: claude296([
    `${'  ❯ /compact-x'.padEnd(52)}Compact the conversation and its tool results`,
    ...CLAUDE_296_COMPACT_MENU.map(unselected),
  ], '❯'),
  draft: '/compact',
};

/**
 * The draft `/clear`, and the menu's pointer on `/clear-history`, a command
 * whose name only starts with it, drawn first; `/clear` and its wrapped
 * description under it, not selected. A reconstruction on
 * CLAUDE_296_TURN_COMPACT's rows: no `/clear-history` was seen, and its words
 * are CLAUDE_CLEAR_OTHER_FIRST's.
 */
export const CLAUDE_296_ON_CLEAR_HISTORY = {
  screen: claude296([
    `${'  ❯ /clear-history'.padEnd(52)}Remove the prompt history`,
    ...CLAUDE_296_CLEAR_MENU.map(unselected),
  ], '❯'),
  draft: '/clear',
};

/**
 * The draft `/compact`, and the 2.1.296 menu, its pointer on `/compact`,
 * drawn UNDER the input box, none above it: a pointer row in the wrong place.
 * A reconstruction: Claude Code 2.1.296 draws its menu above the box.
 */
export const CLAUDE_296_COMPACT_MENU_BELOW = {
  screen: [...CLAUDE_296_ABOVE_MENU, CLAUDE_296_RULE, '❯', CLAUDE_296_RULE, ...CLAUDE_296_COMPACT_MENU],
  draft: '/compact',
};

/**
 * The draft `/compact`, and no menu above the box: only the echo of an
 * earlier `/compact` turn in the history above it, with a row of its answer
 * after it. No pointer row in a menu names the command. A reconstruction: the
 * echo's layout is the answered turn's, and the answer's words are made up.
 */
export const CLAUDE_296_COMPACT_ECHOED = {
  screen: claude296(['❯ /compact', '  ⎿  Conversation compacted'], '❯'),
  draft: '/compact',
};

/**
 * Claude Code at work on a turn, its empty input line below: the row above the
 * box says how to interrupt it, here with a capital E, as either harness may
 * write it. Orca's `tui-idle` can call a harness like this idle (tech notes,
 * section 1). A reconstruction.
 */
export const CLAUDE_WORKING = [
  ...CLAUDE_ABOVE_INPUT.slice(0, 5),
  '✻ Thinking… (12s · ↓ 300 tokens · Esc to interrupt)',
  ...CLAUDE_INPUT_LINE,
];

/** Codex's screen down to its input line: CODEX_ANSWERED's box, its answered turn and the tip. */
const CODEX_ABOVE_INPUT = CODEX_ANSWERED.slice(0, 12);

/** Codex's status rows under its input line, as captured in CODEX_ANSWERED. */
const CODEX_STATUS = CODEX_ANSWERED.slice(13);

/** Codex with `input` as its input line and `below` under it. */
const codexWith = (input, below) => [...CODEX_ABOVE_INPUT, input, ...below];

/**
 * Codex 0.160.0 at its idle input line with nothing in it, not even its
 * placeholder: CODEX_IDLE with the input line a bare `›`. A reconstruction.
 */
export const CODEX_IDLE_EMPTY = CODEX_IDLE.map((row) => (row === '› Ask Codex to do anything' ? '›' : row));

// Codex 0.160.0, as live run 4 of #391 showed it: the slash popup is drawn
// ABOVE the input line, its selected row with Codex's pointer, and Orca's
// screen read never shows the composer's text while the popup is open, even
// with only "/" typed: the input line reads `›` alone. With "/new" typed, the
// popup is filtered down to `/new`'s row. Orca's tui-idle times out with the
// popup open, and stayed out after a backspace. Codex's own snapshot test at
// tag rust-v0.160.0 (codex-rs/tui/src/bottom_pane/snapshots/
// codex_tui__bottom_pane__chat_composer__tests__slash_popup_res.snap) draws the
// popup above a line that does show the text: "› /resume  resume a saved
// chat", "", "› /res", "", "  100% context left". Where a screen below is a
// live capture it says so; above the popup it is CODEX_ANSWERED's box and
// answered turn, a reconstruction.

/** Codex's screen above a popup: CODEX_ANSWERED's box and its answered turn. */
const CODEX_ABOVE_POPUP = CODEX_ANSWERED.slice(0, 11);

/** Codex's status row as live run 4 showed it, the folder as Codex shortened it. */
const CODEX_LIVE_STATUS = '  GPT-6-Luna medium · /private/var/folders/…/bots/clear…';

/** Codex's popup row for each command the kit types, selected, word for word as seen live for /new. */
const CODEX_ROWS = {
  '/new': '› /new  start a new chat during a conversation',
  '/compact': '› /compact  summarize conversation to prevent hitting the context limit',
};

/** Codex with `popup` above its input line, a blank row between, and `input` as the line, as live run 4 showed it. */
const codexPopup = (popup, input = '›') => [...CODEX_ABOVE_POPUP, ...popup, '', input, CODEX_LIVE_STATUS];

/**
 * "/" alone typed into Codex 0.160.0: the popup lists every command, `/model`
 * selected, and the input line reads `›` alone. From the popup down, a live
 * capture (live run 4), partial: the rows between `/fast` and `/approve` were
 * not relayed, nor `/approve`'s description, nor whether a blank row came
 * before the input line.
 */
export const CODEX_SLASH_TYPED = [
  ...CODEX_ABOVE_POPUP,
  '› /model         choose what model and reasoning effort to use',
  '  /fast          1.5x speed',
  '  /approve …',
  '›',
  CODEX_LIVE_STATUS,
];

/**
 * `/new` typed into Codex 0.160.0: the popup filtered down to `/new`'s row,
 * selected, a blank row, and the input line `›` alone. From the popup down, a
 * live capture (live run 4).
 */
export const CODEX_NEW_TYPED = codexPopup([CODEX_ROWS['/new']]);

/**
 * `/new` typed, the popup as in CODEX_NEW_TYPED, and the input line showing
 * the text, `› /new`, as Codex's own snapshot draws it. A reconstruction.
 */
export const CODEX_NEW_TYPED_SHOWN = codexPopup([CODEX_ROWS['/new']], '› /new');

/**
 * `/new` typed, and the input line left bare: the popup above it shows `/new`
 * selected, and the line itself reads `›` alone. A live capture (live run 2 of
 * #391, Codex 0.160.0), partial: the rows the kit's refusal printed, its last
 * rows with the blank ones dropped, the folder as Codex shortened it. The line
 * stayed bare for 3 s. The same layout as CODEX_NEW_TYPED but for the blank row.
 */
export const CODEX_NEW_BARE_INPUT = [
  '• DONE',
  '  Worked for 1m 18s • 10:33 AM',
  '› /new  start a new chat during a conversation',
  '›',
  '  GPT-6-Luna medium · /private/var/folders/…/bots/clear…',
];

/**
 * `/new` typed, and the popup's selected row another command. A reconstruction
 * made up to test the rule: no such screen was seen.
 */
export const CODEX_NEW_OTHER_SELECTED = codexPopup(['› /model         choose what model and reasoning effort to use']);

/**
 * `/new` typed, and the popup not filtered down to it: a second command row
 * above `/new`'s, which is selected and sits nearest the input line. A
 * reconstruction made up to test the rule.
 */
export const CODEX_NEW_TWO_ROWS = codexPopup(['  /model         choose what model and reasoning effort to use', CODEX_ROWS['/new']]);

/** The same popup over an input line that shows the text, `› /new`. A reconstruction made up to test the rule. */
export const CODEX_NEW_TWO_ROWS_SHOWN = codexPopup(['  /model         choose what model and reasoning effort to use', CODEX_ROWS['/new']], '› /new');

/**
 * `/new` typed, and no popup at all: Codex's status rows under the line as
 * when idle, and above it only the echo of the last turn. A reconstruction.
 */
export const CODEX_NEW_NO_MENU = codexWith('› /new', CODEX_STATUS);

/**
 * Codex's `/new` menu with its selection moved down to `2. New worktree`:
 * CODEX_NEW_MENU with the pointer moved, a reconstruction.
 */
export const CODEX_NEW_MENU_ON_TWO = CODEX_NEW_MENU.map((row) => {
  if (row.startsWith('› 1. Current checkout')) return `  ${row.slice(2)}`;
  if (row.startsWith('  2. New worktree')) return `› ${row.slice(2)}`;
  return row;
});

/** `/compact` typed into Codex 0.160.0, its popup filtered to `/compact`, selected, the input line bare. A reconstruction on the live layout. */
export const CODEX_COMPACT_TYPED = codexPopup([CODEX_ROWS['/compact']]);

/**
 * `/compact` typed into a Codex that has no such command: its popup finds
 * nothing to offer, so no row of it is selected. A reconstruction.
 */
export const CODEX_COMPACT_NOT_OFFERED = codexPopup(['  no matches']);

/** Claude Code's menu rows for each command the kit types. */
const CLAUDE_ROWS = { '/clear': CLAUDE_CLEAR_ROWS, '/compact': CLAUDE_COMPACT_ROWS };

/**
 * What the harness shows after each character of `command` but the last, as
 * the kit types it one character a send (#391), on the layout live run 4
 * showed. Claude Code: the typed part in the input line, after its
 * non-breaking space, and above the box the part of the list "/" shows, then
 * the command's own rows. Codex: the input line `›` alone, and above it the
 * whole list for "/", then the command's own row. One screen per send, for the
 * fake Orca's `nextScreens`; the screen after the last character is the test's
 * to give. Reconstructions, but for "/" on Codex, which is CODEX_SLASH_TYPED.
 */
export function whileTyping(harness, command) {
  return [...command].slice(0, -1).map((_, at) => {
    const typed = command.slice(0, at + 1);
    if (harness === 'codex') return typed === '/' ? CODEX_SLASH_TYPED : codexPopup([CODEX_ROWS[command]]);
    return claudeMenuAbove(typed === '/' ? CLAUDE_SLASH_ROWS : CLAUDE_ROWS[command], claudeInput(typed));
  });
}

// Codex 0.162.0, as a live probe for #516 showed it on 2026-10-10 in Orca
// 1.4.223, in a throwaway tab not made by the kit, after one turn. Orca's
// read gives the text of Codex's input line as `draft`, apart from the rows,
// and leaves the key out when the line is empty, as it does for Claude Code
// 2.1.296 (#510). While the line holds text, its row reads `›` alone; empty,
// it shows the placeholder, `› Ask Codex to do anything`. With `/new` or
// `/compact` typed, the slash popup is the command's one row, selected, and
// the input line comes right under it, with no blank row between: Codex
// 0.160.0 drew a blank row there. Each screen was the same 300 ms, 1 s and
// 3 s after the last character. A read with a draft is `{ screen, draft }`,
// as the fake Orca's `nextScreens` takes it.
//
// Each capture is the whole `tail` of one read, with its `draft` from the same
// read, named by its key in the probe's captures1.json. The probe's folder,
// /private/tmp/obk-probe-516.MTulp9, is put back to `<tmp>/obk-probe-516.MTulp9`,
// and nothing else changed. The reconstructions stand on these captures.

/** Codex 0.162.0 after one turn, its input line empty and showing its placeholder: a capture ("after turn"), a read with no draft. */
export const CODEX_162_IDLE = [
  '  >_ OpenAI Codex (v0.162.0)',
  '     <tmp>/obk-probe-516.MTulp9',
  '› Reply with the single word ok, and do nothing else.',
  '• ok',
  '  Worked for 2s • 2:53 AM',
  '› Ask Codex to do anything',
  '  GPT-6.1-Sol default · <tmp>/obk-probe-516.MTulp9 · Reply with ok',
  '  ? for shortcuts',
];

/**
 * A draft, `hello`, typed into the empty input line after that turn: the line
 * reads `›` alone, no placeholder and no `? for shortcuts` row, and the draft
 * comes beside the rows. A capture ("hello"), the rows and the draft from one
 * read.
 */
export const CODEX_162_DRAFT = {
  screen: [
    '  >_ OpenAI Codex (v0.162.0)',
    '     <tmp>/obk-probe-516.MTulp9',
    '› Reply with the single word ok, and do nothing else.',
    '• ok',
    '  Worked for 2s • 2:53 AM',
    '›',
    '  GPT-6.1-Sol default · <tmp>/obk-probe-516.MTulp9 · Reply with ok',
  ],
  draft: 'hello',
};

/**
 * `/compact` typed after that draft: no popup came up, and the draft reads
 * `hello/compact`. A capture ("hello/compact"): the read gave the same rows as
 * CODEX_162_DRAFT's, and this draft.
 */
export const CODEX_162_DRAFT_COMPACT = { screen: CODEX_162_DRAFT.screen, draft: 'hello/compact' };

/**
 * "/" alone typed into the empty input line after that turn: the popup lists
 * commands, `/model` selected, the input line `›` right under it, and the
 * draft `/`. A capture ("turn slash"), the rows and the draft from one read.
 */
export const CODEX_162_SLASH = {
  screen: [
    '  >_ OpenAI Codex (v0.162.0)',
    '     <tmp>/obk-probe-516.MTulp9',
    '› Reply with the single word ok, and do nothing else.',
    '• ok',
    '  Worked for 2s • 2:53 AM',
    '› /model         choose what model and reasoning effort to use',
    '  /fast          2x speed, increased usage',
    '  /ide           include current selection, open files, and other context from your IDE',
    '  /permissions   choose what Codex is allowed to do',
    '  /keymap        remap TUI shortcuts',
    '  /vim           toggle Vim mode for the composer',
    '  /experimental  toggle experimental features',
    '  /approve       approve one retry of a recent auto-review denial',
    '›',
    '  GPT-6.1-Sol default · <tmp>/obk-probe-516.MTulp9 · Reply with ok',
  ],
  draft: '/',
};

/**
 * `/new` typed into the empty input line after that turn, one character a
 * send: the popup's one row, `/new`, selected, the input line `›` right under
 * it with no blank row, and the draft `/new`. A capture ("/new +300ms"), the
 * rows and the draft from one read.
 */
export const CODEX_162_NEW_READ = {
  screen: [
    '  >_ OpenAI Codex (v0.162.0)',
    '     <tmp>/obk-probe-516.MTulp9',
    '› Reply with the single word ok, and do nothing else.',
    '• ok',
    '  Worked for 2s • 2:53 AM',
    '› /new  start a new chat during a conversation',
    '›',
    '  GPT-6.1-Sol default · <tmp>/obk-probe-516.MTulp9 · Reply with ok',
  ],
  draft: '/new',
};

/**
 * `/compact` typed the same way: the popup's one row, `/compact`, selected,
 * the input line `›` right under it, and the draft `/compact`. A capture
 * ("/compact +300ms"), the rows and the draft from one read.
 */
export const CODEX_162_COMPACT_READ = {
  screen: [
    '  >_ OpenAI Codex (v0.162.0)',
    '     <tmp>/obk-probe-516.MTulp9',
    '› Reply with the single word ok, and do nothing else.',
    '• ok',
    '  Worked for 2s • 2:53 AM',
    '› /compact  summarize conversation to prevent hitting the context limit',
    '›',
    '  GPT-6.1-Sol default · <tmp>/obk-probe-516.MTulp9 · Reply with ok',
  ],
  draft: '/compact',
};

/**
 * Codex 0.162.0 after that turn with `popup` right above its input line, no
 * blank row between, and `input` as the line, as the captures above lay it
 * out: their header and answered turn, then the popup, the line, and the
 * status row.
 */
export const codex162With = (popup, input = '›') => [...CODEX_162_IDLE.slice(0, 5), ...popup, input, CODEX_162_IDLE[6]];

/**
 * The idle screen with its placeholder, `› Ask Codex to do anything`, and the
 * draft `hello` beside it. A rebuilt pairing: the live read with this draft
 * showed a bare `›` (CODEX_162_DRAFT). It stands for a draft whose row the
 * screen does not show as text.
 */
export const CODEX_162_PLACEHOLDER_DRAFT = { screen: CODEX_162_IDLE, draft: 'hello' };

/**
 * `/new` typed, the popup as captured, and the input line showing the text,
 * `› /new`, right under it, with no draft. A reconstruction: CODEX_162_NEW_READ's
 * rows with only the input line changed, and its draft left out. No live read
 * showed this line.
 */
export const CODEX_162_NEW_SHOWN = codex162With([CODEX_ROWS['/new']], '› /new');

/**
 * `/new` typed after a draft the kit could not see before its first key: the
 * popup as captured, `/new` selected, and the draft `x/new`. A reconstruction:
 * CODEX_162_NEW_READ with only the draft changed.
 */
export const CODEX_162_NEW_OTHER_DRAFT = { screen: CODEX_162_NEW_READ.screen, draft: 'x/new' };

/** The same with the draft `/new ` (a space after the command). A reconstruction: only the draft changed. */
export const CODEX_162_NEW_SPACE_DRAFT = { screen: CODEX_162_NEW_READ.screen, draft: '/new ' };

/** `/compact` typed after a draft: CODEX_162_COMPACT_READ with only the draft changed, to `x/compact`. A reconstruction. */
export const CODEX_162_COMPACT_OTHER_DRAFT = { screen: CODEX_162_COMPACT_READ.screen, draft: 'x/compact' };

/**
 * The draft `/new`, and the popup's one row another command, `/model`,
 * selected. A reconstruction on CODEX_162_NEW_READ, the `/model` row as
 * CODEX_162_SLASH captured it: no such screen was seen.
 */
export const CODEX_162_NEW_OTHER_SELECTED = {
  screen: codex162With(['› /model         choose what model and reasoning effort to use']),
  draft: '/new',
};

/**
 * The draft `/new`, and the popup not filtered down to it: `/model` above
 * `/new`, which is selected and right above the input line. A reconstruction
 * on CODEX_162_NEW_READ: no such screen was seen.
 */
export const CODEX_162_NEW_TWO_ROWS = {
  screen: codex162With(['  /model         choose what model and reasoning effort to use', CODEX_ROWS['/new']]),
  draft: '/new',
};

/**
 * The draft `/new`, and no popup at all: the rows of the live read with the
 * draft `hello` (CODEX_162_DRAFT), with this draft. A reconstruction: no such
 * read was seen.
 */
export const CODEX_162_NEW_NO_MENU = { screen: CODEX_162_DRAFT.screen, draft: '/new' };

/**
 * What Codex 0.162.0 shows after each character of `command` but the last,
 * one read per send, for the fake Orca's `nextScreens`: for "/" alone the
 * capture CODEX_162_SLASH, and after that the command's own popup row right
 * above a bare `›`, with the draft so far. Reconstructions, but for "/": the
 * probe read the screen only for "/" and for the whole command.
 */
export function whileTypingCodex162(command) {
  return [...command].slice(0, -1).map((_, at) => {
    const typed = command.slice(0, at + 1);
    return typed === '/' ? CODEX_162_SLASH : { screen: codex162With([CODEX_ROWS[command]]), draft: typed };
  });
}

/**
 * Codex at work on a turn, its empty input line below: the row above it says
 * how to interrupt it, in lower case. Orca's `tui-idle` called Codex busy like
 * this idle (tech notes, section 1). A reconstruction.
 */
export const CODEX_WORKING = [
  ...CODEX_ABOVE_INPUT.slice(0, 9),
  '• Working (12s • esc to interrupt)',
  '',
  '› Ask Codex to do anything',
  ...CODEX_STATUS,
];

// The harness's own at-work marker, as seen live (#391, the architect's
// ruling after live run 3). Codex: a row with "esc to interrupt", here as live
// run 3 showed it, "• Working (8s • esc to interrupt)". Claude Code 2.1.288:
// its spinner status row, a glyph, a word ending in "…", then "(" and a time,
// as live run 2 showed it, "✳ Nucleating… (1m 8s · ↓ 131 tokens)"; it shows
// no "esc to interrupt". A finished row, such as CLAUDE_ANSWERED's "✻ Cooked
// for 1s · done 4:14 AM", is no marker. The words of both rows are live; the
// screens around them are reconstructions on the captures above.

/** Claude Code 2.1.288's spinner row while it works, word for word as seen on live run 2. */
const CLAUDE_SPINNER_ROW = '✳ Nucleating… (1m 8s · ↓ 131 tokens)';

/** Codex's at-work row, word for word as seen on live run 3. */
const CODEX_WORKING_ROW = '• Working (8s • esc to interrupt)';

/**
 * Claude Code 2.1.288 at work, its empty input line below: its spinner row and
 * nothing that says "esc to interrupt". Orca's tui-idle may still answer ok. A
 * reconstruction on the live row.
 */
export const CLAUDE_AT_WORK = [...CLAUDE_ABOVE_INPUT.slice(0, 5), CLAUDE_SPINNER_ROW, ...CLAUDE_INPUT_LINE];

/**
 * The harness at work, with `typed` (part or all of `command`) typed, on the
 * layout live run 4 showed: what the screen shows when the harness starts
 * working partway through the kit's typing, or just before its return, every
 * row but the at-work one as it would be with the harness idle. A
 * reconstruction on the live rows.
 */
export function atWork(harness, typed, command) {
  return harness === 'codex'
    ? [...CODEX_ABOVE_POPUP.slice(0, 9), CODEX_WORKING_ROW, '', CODEX_ROWS[command], '', '›', CODEX_LIVE_STATUS]
    : [...CLAUDE_ABOVE_INPUT.slice(0, 5), CLAUDE_SPINNER_ROW, ...(typed === '/' ? CLAUDE_SLASH_ROWS : CLAUDE_ROWS[command]), CLAUDE_LIVE_RULE, claudeInput(typed), CLAUDE_RULE, CLAUDE_LIVE_FOOT];
}

/** A row the pointer starts, whatever follows it: a choice, the input line, or an echoed turn. */
const POINTER_ROW = /^ *[›❯]/;

/** The pointer on a numbered choice: `› 1. Trust and continue`, ` ❯ 2. Not now`. */
const ON_A_NUMBER = /^( *[›❯] +)\d+\. +\S/;

/** Whether `row` holds a numbered choice whose number starts exactly at column `at`. */
const numberedAt = (row, at) => row !== undefined && row.slice(0, at).trim() === '' && /^\d+\. +\S/.test(row.slice(at));

/**
 * The keys a form or menu offers on its foot row, a return among them:
 * Claude Code 2.1.283's "←/→ to change usage · Enter to continue · Esc to
 * cancel" and "Enter to confirm · Esc to cancel", Codex 0.157.1's "enter
 * continue · esc skip", "enter confirm · esc skip" and "enter select · esc
 * back", all captured above.
 */
const FOOT_ROW = /\benter (?:to )?(?:continue|confirm|select)\b|\besc to cancel\b/i;

/** A rule Claude Code draws a form under, or one of its input box's: `─` or `▔` right across. */
const RULE_ROW = /^ *[─▔]{8,}/;

/**
 * The question a screen is asking, as the rows that make it up, or undefined
 * when it asks none, by the rules at the top of this file: a numbered choice
 * list, or a form by its foot row. This is the system tests' own look, not the
 * kit's. A screen it wrongly takes for a question makes a test wait and then
 * fail showing the screen; one it missed would have the test type into the
 * question.
 */
export function questionOn(rows) {
  const at = rows.findLastIndex((row) => POINTER_ROW.test(row));
  const drawn = rows.findLastIndex((row) => row.trim() !== '');
  const pointer = at < 0 ? null : ON_A_NUMBER.exec(rows[at]);
  if (pointer !== null) {
    const column = pointer[1].length;
    if (numberedAt(rows[at - 1], column) || numberedAt(rows[at + 1], column)) {
      let first = at;
      while (first > 0 && numberedAt(rows[first - 1], column)) first -= 1;
      return rows.slice(Math.max(0, first - 3), drawn + 1);
    }
  }

  const from = Math.max(0, at);
  if (rows.slice(from).some((row) => FOOT_ROW.test(row))) {
    const rule = rows.slice(0, from).findLastIndex((row) => RULE_ROW.test(row));
    return rows.slice(rule + 1, drawn + 1);
  }

  // Claude Code 2.1.289 draws its Teach list above its input box, whose own
  // `❯` stays the lowest pointer row (#491): a question there is the last
  // thing drawn above the box's top rule, its foot row or its numbered
  // choices with the pointer on one. The same words with anything after them
  // are history.
  if (at < 1 || !RULE_ROW.test(rows[at - 1])) return undefined;
  const end = rows.slice(0, at - 1).findLastIndex((row) => row.trim() !== '');
  if (end < 0) return undefined;
  const top = rows.slice(0, end).findLastIndex((row) => RULE_ROW.test(row));
  if (FOOT_ROW.test(rows[end])) return rows.slice(top + 1, end + 1);
  if (!NUMBERED_ROW.test(rows[end])) return undefined;
  let first = end;
  while (first > 0 && NUMBERED_ROW.test(rows[first - 1])) first -= 1;
  for (let row = first; row <= end; row += 1) {
    const pointer = ON_A_NUMBER.exec(rows[row]);
    if (pointer !== null && (numberedAt(rows[row - 1], pointer[1].length) || numberedAt(rows[row + 1], pointer[1].length))) {
      return rows.slice(top + 1, end + 1);
    }
  }
  return undefined;
}

/** A numbered choice, with the pointer on it or not. */
const NUMBERED_ROW = /^ *(?:[›❯] +)?\d+\. +\S/;

/**
 * What stands between a live tab and a line a system test wants to type into
 * it, as the sentence a wait that ran out adds to its message, or undefined
 * when nothing does. `orca` is the calling test's own way of asking the real
 * Orca: it takes the arguments, adds `--json` and gives back the answer.
 *
 * A screen that cannot be read counts as in the way: not knowing whether a
 * question is up is no reason to type.
 */
export function waitingOn(orca, handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  if (shown?.source !== 'screen' || !Array.isArray(shown.tail)) {
    const why = answer.ok === true ? `Orca answered with source ${shown?.source}` : `Orca refused: ${JSON.stringify(answer.error)}`;
    return ` The tab's screen could not be read (${why}), so this test cannot tell whether a question of the harness's own is up.`;
  }
  const question = questionOn(shown.tail);
  return question === undefined
    ? undefined
    : ` The tab is waiting on a question of its harness's own, and this test answers none:\n    ${question.join('\n    ')}`;
}

/** The title of Claude Code's "Teach auto mode" form (#416). */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/** A form row with its pointer, wherever it sits, taken out: `❯ Continue` reads as `Continue`. */
const unpointed = (row) => row.replace('❯', ' ').trim();

/**
 * Whether Claude Code's "Teach auto mode about your environment?" form on a
 * tab's rendered `rows` is the captured one and nothing else, the one a system
 * test may answer with Esc in its own throwaway tab (the architect's ruling
 * on #391 after live run 3): undefined when it may, or why not. Every
 * non-blank row from the form's title down is a row of CLAUDE_TEACH_FORM from
 * its title down, the pointer `❯` on exactly one of them, on whichever row
 * it sits; nothing is missing and nothing is added. A row not on that list is
 * refused by name. See test/teach-form.test.js.
 */
export function onlyTeachFormOf(rows) {
  const from = rows.findIndex((row) => row.trim() === TEACH_TITLE);
  if (from < 0) return `it has no "${TEACH_TITLE}" row, so it is not the form captured as CLAUDE_TEACH_FORM`;
  const seen = rows.slice(from).filter((row) => row.trim() !== '');
  const captured = CLAUDE_TEACH_FORM.slice(CLAUDE_TEACH_FORM.findIndex((row) => row.trim() === TEACH_TITLE)).filter((row) => row.trim() !== '');
  const pointers = seen.filter((row) => row.includes('❯')).length;
  if (pointers !== 1) return `it has ${pointers} rows with the pointer ❯, where the captured form has one`;
  const odd = seen.find((row) => !captured.map(unpointed).includes(unpointed(row)));
  if (odd !== undefined) return `it carries a row the captured form does not, which this test has no ruling for: ${odd.trim()}`;
  const missing = captured.find((row) => !seen.map(unpointed).includes(unpointed(row)));
  if (missing !== undefined) return `it lacks a row the captured form has: ${missing.trim()}`;
  if (seen.length !== captured.length) return `it has ${seen.length} rows from its title down, where the captured form has ${captured.length}`;
  return undefined;
}

/** The foot row Claude Code draws under a Teach form or list: `Enter to … · Esc to cancel`. */
const TEACH_FOOT = /^ *(?:.* · )?Enter to \S.* · Esc to cancel *$/;

/**
 * Whether Claude Code 2.1.289's "Teach auto mode about your environment?" list
 * on a tab's rendered `rows` is the captured one and nothing else (#489, the
 * architect's ruling on the 2.1.289 list): undefined when it is, or why not.
 * The rows that count run from the title row to the first foot row under it,
 * `Enter to … · Esc to cancel`; the input box below, with its own `❯`, does
 * not count. Every non-blank row there is a row of CLAUDE_TEACH_LIST from its
 * title to its foot, in the same order, the pointer `❯` on exactly one of
 * them, on whichever row it sits; nothing is missing and nothing is added. A
 * row not on that list is refused by name. And it is framed as Claude Code
 * draws it, not as it is quoted (the ruling on the review of PR #490): the
 * non-blank row right above the title is a rule of `─` or `▔` alone, and the
 * non-blank row right below the foot, if there is one, is the input box's top
 * rule, starting with `─`. See test/teach-list.test.js.
 */
export function onlyTeachListOf(rows) {
  const block = (shown) => {
    const from = shown.findIndex((row) => row.trim() === TEACH_TITLE);
    if (from < 0) return undefined;
    const foot = shown.findIndex((row, at) => at > from && TEACH_FOOT.test(row));
    return foot < 0 ? undefined : shown.slice(from, foot + 1).filter((row) => row.trim() !== '');
  };
  if (!rows.some((row) => row.trim() === TEACH_TITLE)) return `it has no "${TEACH_TITLE}" row, so it is not the list captured as CLAUDE_TEACH_LIST`;
  const seen = block(rows);
  if (seen === undefined) return 'it has no "Enter to … · Esc to cancel" row under its title, so it is not the list captured as CLAUDE_TEACH_LIST';
  const captured = block(CLAUDE_TEACH_LIST);
  const pointers = seen.filter((row) => row.includes('❯')).length;
  if (pointers !== 1) return `it has ${pointers} rows with the pointer ❯ from its title to its foot, where the captured list has one`;
  const odd = seen.find((row) => !captured.map(unpointed).includes(unpointed(row)));
  if (odd !== undefined) return `it carries a row the captured list does not, which this test has no ruling for: ${odd.trim()}`;
  const missing = captured.find((row) => !seen.map(unpointed).includes(unpointed(row)));
  if (missing !== undefined) return `it lacks a row the captured list has: ${missing.trim()}`;
  if (seen.length !== captured.length) return `it has ${seen.length} rows from its title to its foot, where the captured list has ${captured.length}`;
  const outOfOrder = seen.find((row, at) => unpointed(row) !== unpointed(captured[at]));
  if (outOfOrder !== undefined) return `its rows are not in the captured list's order: ${outOfOrder.trim()}`;
  const from = rows.findIndex((row) => row.trim() === TEACH_TITLE);
  const above = rows.slice(0, from).findLast((row) => row.trim() !== '');
  if (above === undefined || !/^\s*(?:─+|▔+)\s*$/.test(above)) return `the row above its title is not a rule, so it is quoted, not drawn: ${above?.trim() ?? '(none)'}`;
  const foot = rows.findIndex((row, at) => at > from && TEACH_FOOT.test(row));
  const below = rows.slice(foot + 1).find((row) => row.trim() !== '');
  if (below !== undefined && !/^\s*─/.test(below)) return `the row below its foot is not the input box's rule, so it is quoted, not drawn: ${below.trim()}`;
  return undefined;
}

/**
 * Whether Claude Code's folder trust on a tab's rendered `rows` is the plain one
 * for `folder`, the one a system test may answer in its own throwaway tab (the
 * rulings on #238 after #450, and on #451): undefined when it may, or what
 * makes it a screen the test leaves alone. No permission is pre-approved, the
 * folder shown is `folder` in either spelling of a macOS temp path, and the
 * pointer is on "No, exit" with "Yes, I trust this folder" below it. Shared by
 * codex-groom-run and send-outside-fleet; see test/plain-trust.test.js.
 */
export function plainTrustOf(rows, folder) {
  if (rows.some((row) => /\bpre-approves\b/.test(row))) return 'it names a pre-approved permission, and this folder should have none yet';
  const bare = folder.replace(/^\/private(?=\/)/, '');
  const spellings = new Set([folder, bare, `/private${bare}`]);
  if (!rows.some((row) => spellings.has(row.trim()))) return `it does not show this test's folder, ${folder}`;
  if (!rows.some((row) => /^\s*❯\s*No, exit\s*$/.test(row))) return 'its pointer is not on "No, exit", where down-and-return would mean "Yes, I trust this folder"';
  if (!rows.some((row) => /^\s*Yes, I trust this folder\s*$/.test(row))) return 'it has no "Yes, I trust this folder" choice';
  return undefined;
}

/**
 * Whether Claude Code's folder trust on a tab's rendered `rows` is the plain
 * one for `folder` and nothing else (the ruling on #451, comment 5961132572):
 * undefined when the test may answer it, or what makes it a screen left alone.
 * Every non-blank row from "Accessing workspace:" down is a row of the captured
 * plain screen, CLAUDE_TRUST, with `folder`, in either spelling of a macOS temp
 * path, where that screen shows its folder; and plainTrustOf holds. A row not
 * on that list is refused by name. See test/plain-trust.test.js.
 */
export function onlyPlainTrustOf(rows, folder) {
  const from = rows.findIndex((row) => /Accessing workspace:/.test(row));
  if (from < 0) return 'it has no "Accessing workspace:" row, so it is not the screen captured as the plain folder trust';
  const captured = CLAUDE_TRUST.slice(CLAUDE_TRUST.findIndex((row) => /Accessing workspace:/.test(row)));
  const capturedFolder = captured[1].trim();
  const bare = folder.replace(/^\/private(?=\/)/, '');
  const allowed = new Set([
    ...captured.map((row) => row.trim()).filter((row) => row !== '' && row !== capturedFolder),
    folder, bare, `/private${bare}`,
  ]);
  const odd = rows.slice(from).find((row) => row.trim() !== '' && !allowed.has(row.trim()));
  if (odd !== undefined) return `it carries a row the plain folder trust does not, which this test has no ruling for: ${odd.trim()}`;
  return plainTrustOf(rows, folder);
}
