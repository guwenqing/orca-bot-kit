// A kit write of the book never writes through a link at the name of its own
// temporary file (#599).
//
// The kit writes the book, `<bot home>/sessions.yaml`, in one step: the new
// text goes to a file of its own beside it, `sessions.yaml.<pid>.part`, and
// that file is renamed over the book. A session can make links in its own bot
// folder (a Codex session can, inside its sandbox), and pids on a machine come
// close to one after another, so a link may already be waiting at that name.
// A write of the book then writes nothing into the place the link leads to,
// outside the bot folder: a file there keeps its text, and a link to a name
// with nothing at it makes no file there. And the book afterwards is a file,
// not a link.
//
// The write may go through or refuse; either is taken. When it goes through,
// the book holds the change it was asked to make: a write that reports success
// and drops the change is the lost write the book's lock exists to stop
// (#161), so that much is part of the intent. When it refuses, a book that was
// there before is still a file; nothing more is asked of it.
//
// One more kind of link is pinned: a hard link at the `.part` name to a file
// outside. It is a link a session can make as easily, and a write through it
// changes the file outside just the same. The fix the issue suggests (take away
// whatever is at the name, then make the file new) answers it too.
//
// The seam is `updateBook`, in this process: every write of the book goes
// through it, the hook's and `up`'s alike, and in this process the writer's pid
// is `process.pid`, so the name is hit without changing anything about the
// write. A kit that names its temporary file another way is simply not hit.
// The bots folder is made by `init` and `bot create` in the sandbox
// (helpers/cli.js), so the lock is taken where the kit takes it.

import assert from 'node:assert/strict';
import { access, link, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { readBook, updateBook } from '../src/book.js';
import { bookOf, botHomeOf, createSandbox } from './helpers/cli.js';

const BOT = 'api-bot';
const OUTSIDE_TEXT = 'a file of the user\'s, outside the bot folder\n';

const isThere = (file) => access(file).then(() => true, () => false);

/** api-bot's home, in a bots folder made by the kit. Answers the bot home and its book. */
async function aBot(box) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, `${init.stdout}${init.stderr}`);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  return { home: botHomeOf(box.path('bots'), BOT), book: bookOf(box.path('bots'), BOT) };
}

/** A change to the book that adds one session the test can look for afterwards. */
const addSession = (name, tab) => (book) => {
  book.sessions[name] = { tab };
  return book;
};

/**
 * Run one write of the book with something planted at its `.part` name, and
 * answer how it ended: `{ went: true }`, or `{ went: false, error }`.
 */
async function writeWith(home, change) {
  try {
    await updateBook(home, change);
    return { went: true };
  } catch (error) {
    return { went: false, error };
  }
}

const told = (ended) => (ended.went ? 'the write went through' : `the write refused: ${ended.error?.message}`);

/** The book after the write: never a link; a file when there was one before or the write went through. */
async function bookStaysAFile(book, ended, { wasThere }) {
  if (!ended.went && !wasThere && !(await isThere(book))) return;
  const after = await lstat(book);
  assert.equal(after.isSymbolicLink(), false, `sessions.yaml is not made a link, ${told(ended)}`);
  assert.equal(after.isFile(), true, `sessions.yaml is still a file, ${told(ended)}`);
}

/** When the write went through, the book holds the session it was asked to add. */
function changeKept(home, ended, name, tab) {
  if (!ended.went) return;
  assert.deepEqual(readBook(home).sessions[name], { tab }, 'the book holds the change the write went through with');
}

// Whether a book is there before the write: a bot's first write makes it, and
// every later one replaces it.
const BOOKS = [
  ['a book already there', true],
  ['no book yet', false],
];

for (const [bookLabel, wasThere] of BOOKS) {
  test(`B599 with ${bookLabel}, a book write with a link at sessions.yaml.<pid>.part to a file outside leaves that file's text, and sessions.yaml stays a file`, async (t) => {
    const box = await createSandbox(t);
    const { home, book } = await aBot(box);
    if (wasThere) await updateBook(home, addSession('daily', 'tab-before'));
    else await rm(book, { force: true });
    assert.equal(await isThere(book), wasThere, 'the premise: the book is there or not, as the case says');

    const outside = path.join(box.root, 'outside', 'target.txt');
    await mkdir(path.dirname(outside), { recursive: true });
    await writeFile(outside, OUTSIDE_TEXT);
    await symlink(outside, path.join(home, `sessions.yaml.${process.pid}.part`));

    const ended = await writeWith(home, addSession('nightly', 'tab-new'));

    assert.equal(await readFile(outside, 'utf8'), OUTSIDE_TEXT, `the file outside keeps its text, ${told(ended)}`);
    await bookStaysAFile(book, ended, { wasThere });
    changeKept(home, ended, 'nightly', 'tab-new');
  });

  test(`B599 with ${bookLabel}, a book write with a link at sessions.yaml.<pid>.part to a name outside with nothing at it makes no file there, and sessions.yaml stays a file`, async (t) => {
    const box = await createSandbox(t);
    const { home, book } = await aBot(box);
    if (wasThere) await updateBook(home, addSession('daily', 'tab-before'));
    else await rm(book, { force: true });
    assert.equal(await isThere(book), wasThere, 'the premise: the book is there or not, as the case says');

    const outside = path.join(box.root, 'outside', 'target.txt');
    await mkdir(path.dirname(outside), { recursive: true });
    await symlink(outside, path.join(home, `sessions.yaml.${process.pid}.part`));

    const ended = await writeWith(home, addSession('nightly', 'tab-new'));

    assert.equal(await isThere(outside), false, `no file is made outside at ${outside}, ${told(ended)}`);
    await bookStaysAFile(book, ended, { wasThere });
    changeKept(home, ended, 'nightly', 'tab-new');
  });
}

test('B599 a book write with a hard link at sessions.yaml.<pid>.part to a file outside leaves that file\'s text, and sessions.yaml stays a file', async (t) => {
  const box = await createSandbox(t);
  const { home, book } = await aBot(box);
  await updateBook(home, addSession('daily', 'tab-before'));

  // In the sandbox, so on the same volume as the bot home: a hard link can be made.
  const outside = path.join(box.root, 'outside', 'target.txt');
  await mkdir(path.dirname(outside), { recursive: true });
  await writeFile(outside, OUTSIDE_TEXT);
  await link(outside, path.join(home, `sessions.yaml.${process.pid}.part`));

  const ended = await writeWith(home, addSession('nightly', 'tab-new'));

  assert.equal(await readFile(outside, 'utf8'), OUTSIDE_TEXT, `the file outside keeps its text, ${told(ended)}`);
  await bookStaysAFile(book, ended, { wasThere: true });
  changeKept(home, ended, 'nightly', 'tab-new');
});
