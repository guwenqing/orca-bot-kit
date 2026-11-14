// A system test lists a mailbox only through test/helpers/inbox.js
// `inboxLetters` (#748).
//
// From Orca 1.4.246, `orca orchestration inbox` answers short unless it is
// given `--full`, with no `read`, `delivered_at`, `run_id`, `to_handle` or
// `sequence` in a letter. Five live tests ran the list call themselves with no
// `--full`, so on the owner's 1.4.255 each letter read as unread, or no letter
// of the test's own Run was found. `inboxLetters` gives the call `--full`, asks
// again without it only when Orca refuses the flag as unknown, and shows none
// of Orca's text in a failure (test/inbox.test.js). One helper does the call,
// not a copy in each file.
//
// This reads the system tests as text; it runs none of them. A file is named
// when its code passes `orchestration inbox` as an argument list: the string
// 'orchestration' and then the string 'inbox', side by side in a list, as in
// `spawnSync(ORCA, ['orchestration', 'inbox', …])` or `orca(['orchestration',
// 'inbox', …])`. That holds with `--full` in the list too: the call belongs in
// the helper. Not named:
//
//   - a command typed as one string into a tab that already carries `--full`
//     (test/system/check-retry-request.test.js types `… orchestration inbox
//     --terminal run:… --limit 20 --full --json > …`). A string is not an
//     argument list, so no string is read for the call, with `--full` or not;
//   - a message that names the command, in a string;
//   - a comment. Comments are taken out before anything is read.
//
// Without a parser the check cannot always tell a division from a regular
// expression, so it reads each file twice: once with a `/` that has another
// `/` after it on the line taken for a regular expression, and once with no
// regular expressions at all (as test/system-teach-record.test.js does). What
// either reading shows is named, so a misread slash fails loudly and does not
// hide a call. Without a parser the check also cannot follow a word through a
// variable (`const LIST = 'inbox'; ['orchestration', LIST]`); that call is not
// named.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot, snapshot } from './helpers/cli.js';

const systemTestsDir = path.join(repoRoot, 'test', 'system');

const OWN_CALL = 'it lists a mailbox with its own orchestration inbox call: list it through inboxLetters from \'../helpers/inbox.js\'';

/** The closing slash of the regular expression that would start at the `/` at `at`, on the same line, or -1. */
function regexEnd(source, at) {
  let inClass = false;
  for (let next = at + 1; next < source.length && source[next] !== '\n'; next += 1) {
    const here = source[next];
    if (here === '\\') {
      if (source[next + 1] === '\n') return -1;
      next += 1;
    } else if (here === '[') inClass = true;
    else if (here === ']') inClass = false;
    else if (here === '/' && !inClass) return next;
  }
  return -1;
}

/**
 * The tokens of `source`, comments left out: `{ string }` for each string
 * literal, and each template literal with no `${…}`, with its text; `{ code }`
 * for each other character that is not white space, and each name or number as
 * one. The code inside a template's `${…}` is read as code; the text around it
 * is no string here. With `regex` (the default), a `/` that has another `/`
 * after it on the line is a regular expression, one `{ code }` token, and the
 * rest of the line is code, so a `//` there is no comment. Without it, every
 * `/` is a plain character.
 */
function tokensOf(source, { regex = true } = {}) {
  const tokens = [];
  let at = 0;
  let codeToLineEnd = false;
  // The frames from the outside in: code, or a template literal's text.
  const frames = [{ kind: 'code', depth: 0, inTemplate: false }];
  while (at < source.length) {
    const frame = frames[frames.length - 1];
    const here = source[at];
    const next = source[at + 1];

    if (frame.kind === 'template') {
      if (here === '\\') {
        frame.text += here + (next ?? '');
        at += 2;
      } else if (here === '`') {
        if (frame.parts === 0) tokens.push({ string: frame.text });
        else tokens.push({ code: '`' });
        frames.pop();
        at += 1;
      } else if (here === '$' && next === '{') {
        tokens.push({ code: '`${' });
        frame.text = '';
        frame.parts += 1;
        frames.push({ kind: 'code', depth: 0, inTemplate: true });
        at += 2;
      } else {
        frame.text += here;
        at += 1;
      }
      continue;
    }

    if (here === '\n') {
      codeToLineEnd = false;
      at += 1;
      continue;
    }
    if (/\s/.test(here)) {
      at += 1;
      continue;
    }
    if (!codeToLineEnd && here === '/' && next === '/') {
      while (at < source.length && source[at] !== '\n') at += 1;
      continue;
    }
    if (!codeToLineEnd && here === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2);
      at = end < 0 ? source.length : end + 2;
      continue;
    }
    if (regex && here === '/') {
      const end = regexEnd(source, at);
      // A backtick is left as it is: a template it opened could run on for lines.
      if (end > at && !source.slice(at, end).includes('`')) {
        tokens.push({ code: source.slice(at, end + 1) });
        at = end + 1;
        codeToLineEnd = true;
        continue;
      }
    }
    if (here === '\'' || here === '"') {
      let end = at + 1;
      let text = '';
      while (end < source.length && source[end] !== here && source[end] !== '\n') {
        if (source[end] === '\\') {
          text += source[end] + (source[end + 1] ?? '');
          end += 2;
        } else {
          text += source[end];
          end += 1;
        }
      }
      tokens.push({ string: text });
      at = source[end] === here ? end + 1 : end;
      continue;
    }
    if (here === '`') {
      frames.push({ kind: 'template', text: '', parts: 0 });
      at += 1;
      continue;
    }
    const word = /^[\w$]+/.exec(source.slice(at, at + 200));
    if (word !== null) {
      tokens.push({ code: word[0] });
      at += word[0].length;
      continue;
    }
    if (here === '{') frame.depth += 1;
    if (here === '}') {
      if (frame.depth === 0 && frame.inTemplate) {
        frames.pop();
        tokens.push({ code: '}`' });
        at += 1;
        continue;
      }
      frame.depth -= 1;
    }
    tokens.push({ code: here });
    at += 1;
  }
  return tokens;
}

/** Whether `tokens` hold the string 'orchestration', a comma, then the string 'inbox': the command in an argument list. */
function listsInbox(tokens) {
  return tokens.some((token, at) => token.string === 'orchestration'
    && tokens[at + 1]?.code === ','
    && tokens[at + 2]?.string === 'inbox');
}

/** Whether `tokens` hold an orchestration command as an argument list, of any command, or a call `inboxLetters(`. */
function readsAsCalls(tokens) {
  return tokens.some((token, at) => (token.string === 'orchestration' && tokens[at + 1]?.code === ',' && tokens[at + 2]?.string !== undefined)
    || (token.code === 'inboxLetters' && tokens[at + 1]?.code === '('));
}

/** What is wrong in a system test's source, in either reading. */
function inboxTrouble(source) {
  return listsInbox(tokensOf(source)) || listsInbox(tokensOf(source, { regex: false })) ? [OWN_CALL] : [];
}

// --------------------------------------------------------- the check itself

/** A system test that lists a mailbox through the helper, and names the command in its messages. */
const THROUGH_HELPER = `
import assert from 'node:assert/strict';
import { inboxLetters } from '../helpers/inbox.js';

/** The letters of one Run, read through the helper. */
function lettersIn(mailbox) {
  const letters = inboxLetters(ORCA, { terminal: \`run:\${mailbox}\`, limit: 20 });
  assert.ok(letters.length > 0, \`orca orchestration inbox --terminal run:\${mailbox} answered no letter\`);
  return letters.map((one) => ({ read: one.read === 1, delivered: one.delivered_at != null }));
}
`;

/** A system test in the shape of restart-mail-work.test.js before #748: its own list call through an \`orca(…)\` function. */
const OWN_ORCA_CALL = `
function lettersIn(mailbox) {
  const answer = orca(['orchestration', 'inbox', '--terminal', \`run:\${mailbox}\`, '--limit', String(MAIL_LIMIT)]);
  assert.equal(answer.ok, true, \`orca orchestration inbox for run:\${mailbox} failed\`);
  return answer.result.messages.map((one) => ({ read: one?.read === 1, delivered: one?.delivered_at != null }));
}
`;

/** A system test in the shape of permissions.test.js before #748: its own list call through spawnSync, over the whole machine. */
const OWN_SPAWN = `
function inboxOf(run) {
  const asked = \`orca orchestration inbox --json --limit \${INBOX_LIMIT}\`;
  const done = spawnSync(ORCA, ['orchestration', 'inbox', '--json', '--limit', String(INBOX_LIMIT)], { encoding: 'utf8' });
  return JSON.parse(done.stdout).result.messages.filter((message) => message?.run_id === run);
}
`;

test('the check passes a system test that lists a mailbox through the helper, with the command named only in messages', () => {
  assert.deepEqual(inboxTrouble(THROUGH_HELPER), []);
});

test('the check names a system test with its own list call, through an orca(…) function or through spawnSync', () => {
  assert.deepEqual(inboxTrouble(OWN_ORCA_CALL), [OWN_CALL]);
  assert.deepEqual(inboxTrouble(OWN_SPAWN), [OWN_CALL]);
});

test('the check names its own list call in any shape of list: other quotes, other lines, with --full', () => {
  const calls = [
    'spawnSync(ORCA, ["orchestration", "inbox", "--json"]);',
    'spawnSync(ORCA, [`orchestration`, `inbox`, \'--json\']);',
    "orca([\n  'orchestration',\n  'inbox',\n  '--limit', '20',\n]);",
    "orca(['orchestration', 'inbox', '--terminal', `run:${id}`, '--limit', '20', '--full']);",
    "spawnSync(ORCA, ['orchestration', 'inbox', '--full', '--json'], { encoding: 'utf8' });",
    "execFileSync(ORCA, ['orchestration' , 'inbox']);",
    "const args = ['orchestration', 'inbox', '--json'];",
  ];
  for (const call of calls) assert.deepEqual(inboxTrouble(`${THROUGH_HELPER}${call}\n`), [OWN_CALL], call);
});

test('the check passes a command typed as one string that carries --full, as check-retry-request.test.js types it', () => {
  const typed = `${THROUGH_HELPER}
const sent = orca(['terminal', 'send', '--terminal', handle, '--text', [
  \`\${orcaWord} orchestration inbox --terminal run:\${run.id} --limit 20 --full --json > \${shellWord(file('inbox.json'))}\`,
].join('; '), '--enter']);
`;
  assert.deepEqual(inboxTrouble(typed), []);
});

test('the check is not fooled by comments or strings: a list call in a comment, or in a message, is none', () => {
  const inComments = `${THROUGH_HELPER}// const answer = orca(['orchestration', 'inbox', '--limit', '20']);\n/* spawnSync(ORCA, ['orchestration', 'inbox']) */\n`;
  assert.deepEqual(inboxTrouble(inComments), [], 'a list call in comments is not code');

  const inStrings = `${THROUGH_HELPER}t.diagnostic("was: orca(['orchestration', 'inbox', '--json'])");\nconst note = \`spawnSync(ORCA, ['orchestration', 'inbox'])\`;\n`;
  assert.deepEqual(inboxTrouble(inStrings), [], 'a list call written inside a string is not code');

  const otherCommands = `${THROUGH_HELPER}orca(['orchestration', 'check', '--peek']);\norca(['orchestration', 'run-show', '--id', 'inbox']);\n`;
  assert.deepEqual(inboxTrouble(otherCommands), [], 'another orchestration command is no list call of inbox');
});

test('a misread slash never hides a list call: a quote in a regular expression, or a division the check takes for one', () => {
  const quoteInRegex = `${THROUGH_HELPER}const ok = /'/.test(text) && orca(['orchestration', 'inbox', '--json']);\n`;
  assert.deepEqual(inboxTrouble(quoteInRegex), [OWN_CALL], 'a quote in a regular expression opens no string');

  const division = `${THROUGH_HELPER}const half = n / 2; const s = 'a/b'; orca(['orchestration', 'inbox', '--json']);\n`;
  assert.deepEqual(inboxTrouble(division), [OWN_CALL], 'the reading with no regular expressions shows the call');

  const slashesInString = `${THROUGH_HELPER}const url = 'http://x//y'; orca(['orchestration', 'inbox', '--json']);\n`;
  assert.deepEqual(inboxTrouble(slashesInString), [OWN_CALL], 'a // in a string is no comment');
});

// ------------------------------------------------------------- the system tests

test('no system test lists a mailbox with its own orchestration inbox call: each goes through inboxLetters', async () => {
  const tree = await snapshot(systemTestsDir);
  const files = Object.keys(tree).filter((rel) => tree[rel].startsWith('file:') && rel.endsWith('.js')).sort();
  assert.ok(files.length > 0, 'there should be system tests to check');

  const found = [];
  // The check reads real files: some system test passes an orchestration
  // command as an argument list (`['orchestration', 'run-show', …]`), or calls
  // inboxLetters(. If none does, the reading is broken, not the files clean.
  let seen = 0;
  for (const rel of files) {
    const source = await readFile(path.join(systemTestsDir, rel), 'utf8');
    if (readsAsCalls(tokensOf(source))) seen += 1;
    for (const why of inboxTrouble(source)) found.push(`test/system/${rel}: ${why}`);
  }
  assert.ok(seen > 0, 'no system test passes an orchestration command as an argument list or calls inboxLetters(, so the check sees nothing');
  assert.deepEqual(found, [], `system tests that list a mailbox without test/helpers/inbox.js:\n  ${found.join('\n  ')}`);
});
