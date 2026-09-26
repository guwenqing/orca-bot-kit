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

/**
 * Claude Code 2.1.283's folder-trust list, its selection on `No, exit`, its
 * choices unnumbered: a capture, the whole `tail` of a kit-made tab. Above it,
 * the launch line the kit typed, wrapped where the screen is 120 columns wide,
 * and the mailbox step's answer. Not a question by the rule at the top; see
 * CLAUDE_TRUST_AS_ORCA_SAW_IT for why nothing is typed into it all the same.
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

/** A row the pointer starts, whatever follows it: a choice, the input line, or an echoed turn. */
const POINTER_ROW = /^ *[›❯]/;

/** The pointer on a numbered choice: `› 1. Trust and continue`, ` ❯ 2. Not now`. */
const ON_A_NUMBER = /^( *[›❯] +)\d+\. +\S/;

/** Whether `row` holds a numbered choice whose number starts exactly at column `at`. */
const numberedAt = (row, at) => row !== undefined && row.slice(0, at).trim() === '' && /^\d+\. +\S/.test(row.slice(at));

/**
 * The question a screen is asking, as the rows that make it up, or undefined
 * when it asks none, by the rule at the top of this file. This is the system
 * tests' own look, not the kit's. A screen it wrongly takes for a question
 * makes a test wait and then fail showing the screen; one it missed would have
 * the test type into the question.
 */
export function questionOn(rows) {
  const at = rows.findLastIndex((row) => POINTER_ROW.test(row));
  if (at < 0) return undefined;
  const pointer = ON_A_NUMBER.exec(rows[at]);
  if (pointer === null) return undefined;
  const column = pointer[1].length;
  if (!numberedAt(rows[at - 1], column) && !numberedAt(rows[at + 1], column)) return undefined;

  let first = at;
  while (first > 0 && numberedAt(rows[first - 1], column)) first -= 1;
  const drawn = rows.findLastIndex((row) => row.trim() !== '');
  return rows.slice(Math.max(0, first - 3), drawn + 1);
}

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
