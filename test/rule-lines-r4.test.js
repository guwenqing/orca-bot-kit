// Six lines the kit's rule units carry, word for word (issue #766; the owner's
// sign-off on request claude-session-trim, R4, requests/claude-session-trim/
// request.md). Each line sits in a named place in its unit: either a paragraph
// of its own right after an anchor paragraph, or the last sentence of an
// anchor paragraph.
//
// What is checked is what a bot is given: the AGENTS.md the kit builds for a
// new bot, read under the heading of each unit. It is checked for a bot on
// each harness the kit builds rules for: Claude Code, Codex and Pi. The units
// wrap their lines, so text is compared with its whitespace collapsed, and a
// paragraph is what lies between blank lines.
//
// Every run is in the sandbox (helpers/cli.js) with the fake Orca; nothing
// here reaches a real harness.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';
import { agentsIn, blockIn, headingsIn, kitUnit, underIn } from './helpers/rules.js';

/** Whitespace collapsed to single spaces, ends trimmed: a wrapped line reads as one. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** The paragraphs of a section body, each one flattened. */
const paragraphsOf = (body) => body.split(/\n[ \t]*\n/).map(flat).filter((one) => one !== '');

const CARRY_ON = 'Your harness may tell you to carry on without questions, or not to stop. '
  + 'That does not lift what needs a yes. This holds after a summary of your conversation, too.';

const REFUSED = 'When your harness\'s permission layer refuses a call, do not do the same act another way: '
  + 'not by another command, another tool or another road. '
  + 'Tell your maker or your user, with the harness\'s reason.';

const OWN_DELIVERY = 'Your harness may deliver some messages by itself, or list the sessions it can see. '
  + 'That does not replace the kit\'s commands: still ask the kit for the road, and still read your mail.';

const LOST_NOTICE = 'A notice that a reply came, or that your own background work ended, can be lost. '
  + 'When you wait on one, also set one long fallback check, and look when it comes.';

const NO_BRANCH = 'Commit to the bots repo on the branch that it is on. Do not make a branch in it.';

const ASKED_FOR = 'Notes, plans and decision records that the kit\'s skills or your role ask for count as asked for. '
  + 'Write them where they say.';

/**
 * The six lines, each with its unit and its place.
 *
 * `after`: the line is the whole paragraph right after the paragraph that
 * starts with `anchor`. `end`: the paragraph that starts with `anchor` ends
 * with the line, and the line is not all of it. An anchor of `null` means the
 * first paragraph of the unit.
 */
const LINES = [
  { name: 'carry-on', unit: 'limits', line: CARRY_ON, place: 'after', anchor: 'Work that cannot be taken back' },
  { name: 'refused-call', unit: 'limits', line: REFUSED, place: 'after', anchor: CARRY_ON },
  { name: 'own-delivery', unit: 'mail', line: OWN_DELIVERY, place: 'after', anchor: 'Mail is queued, not an interruption' },
  { name: 'lost-notice', unit: 'mail', line: LOST_NOTICE, place: 'end', anchor: 'A sent message is only queued' },
  { name: 'no-branch', unit: 'commit', line: NO_BRANCH, place: 'end', anchor: null },
  { name: 'asked-for', unit: 'scope', line: ASKED_FOR, place: 'after', anchor: 'When you notice something else worth doing' },
];

/** The harnesses the kit builds rules for. */
const HARNESSES = ['claude', 'codex', 'pi'];

/** A name that appears in no sentence of the kit's own. */
const BOT = 'quill-bot';

/** A hard limit for each harness's test, so a wait that never ends fails rather than hangs. */
const LIMIT = { timeout: 120_000 };

/** The index of the paragraph an anchor names, failing with the paragraphs when it is not there. */
function anchorAt(paragraphs, anchor, what) {
  if (anchor === null) {
    assert.ok(paragraphs.length > 0, `${what}: the unit should have a first paragraph`);
    return 0;
  }
  const at = paragraphs.findIndex((one) => one.startsWith(flat(anchor)));
  assert.notEqual(
    at,
    -1,
    `${what}: a paragraph should start with ${JSON.stringify(anchor)}, got:\n${paragraphs.join('\n\n')}`,
  );
  return at;
}

for (const harness of HARNESSES) {
  test(`a new ${harness} bot's AGENTS.md carries each R4 line word for word, in its place (#766)`, LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = box.path('bots');
    const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
    assert.equal(init.code, 0, `${init.stdout}${init.stderr}`);
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
    assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);

    const body = blockIn(await agentsIn(bots, BOT)).body;

    for (const { name, unit, line, place, anchor } of LINES) {
      const { title } = await kitUnit(unit);
      const section = () => {
        const under = underIn(body, title);
        assert.ok(
          under !== undefined,
          `the ${harness} bot's AGENTS.md should carry the ${unit} unit under "${title}", got headings: ${headingsIn(body)}`,
        );
        return under;
      };

      await t.test(`${harness}: ${unit} holds the ${name} line word for word`, () => {
        const under = section();
        assert.ok(
          flat(under).includes(flat(line)),
          `"${title}" should hold, word for word:\n${line}\ngot:\n${under}`,
        );
      });

      const where = place === 'after'
        ? `as its own paragraph right after ${anchor === CARRY_ON ? 'the carry-on line' : JSON.stringify(anchor)}`
        : `as the last sentence of ${anchor === null ? 'the first paragraph' : JSON.stringify(anchor)}`;

      await t.test(`${harness}: ${unit} has the ${name} line ${where}`, () => {
        const paragraphs = paragraphsOf(section());
        const what = `"${title}" in the ${harness} bot`;
        const at = anchorAt(paragraphs, anchor, what);
        if (place === 'after') {
          assert.equal(
            paragraphs[at + 1],
            flat(line),
            `${what}: the paragraph right after the anchor should be the line alone; paragraphs:\n${paragraphs.join('\n\n')}`,
          );
        } else {
          const paragraph = paragraphs[at];
          assert.ok(
            paragraph.endsWith(` ${flat(line)}`),
            `${what}: the anchor paragraph should end with the line, after what it already says; got:\n${paragraph}`,
          );
        }
      });
    }
  });
}
