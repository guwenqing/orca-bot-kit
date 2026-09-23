// Every bot's work folder stays out of the bots repo, Bot Father's included
// (#172; PRD 6.3: "work/ is gitignored").
//
// `work/` is a bot's scratch space: clones, downloads, whatever a session is
// working on. `obk bot create` has always kept it out of the repo. Bot Father is
// made by `obk init` rather than by `bot create`, and has to be kept the same.
//
// Asked of git itself, never of an ignore file's text: how the kit arranges its
// ignores is the implementer's business, and what the user sees is whether
// `git status` lists the file.

import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { botHomeOf, createSandbox, git } from './helpers/cli.js';

/** Write a file of a session's at `rel` inside one bot's folder. */
async function put(bots, bot, rel, text = 'something a session made\n') {
  const file = path.join(botHomeOf(bots, bot), rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return path.relative(bots, file).split(path.sep).join('/');
}

/** What the bots repo would offer to commit, every untracked file listed on its own. */
async function waiting(bots) {
  const status = await git(['status', '--porcelain', '--untracked-files=all'], bots);
  assert.equal(status.code, 0, status.stderr);
  return status.stdout;
}

/** Whether git ignores `rel` in the bots repo. */
const ignored = async (bots, rel) => (await git(['check-ignore', '--quiet', rel], bots)).code === 0;

/** Assert the repo keeps `work` out and still offers `own`: the pair that tells an ignore from a repo that lists nothing. */
async function assertWorkOnlyIgnored(bots, work, own) {
  const listed = await waiting(bots);
  assert.equal(await ignored(bots, work), true, `${work} should be ignored by the bots repo, and git status says:\n${listed}`);
  assert.ok(!listed.includes(work), `git status should not list ${work}:\n${listed}`);
  assert.equal(await ignored(bots, own), false, `${own} is the user's and belongs in the repo`);
  assert.ok(listed.includes(own), `git status should list ${own}:\n${listed}`);
}

test('WI1 after init, a file in Bot Father\'s work folder is ignored, and one beside it is not', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');

  const work = await put(bots, 'bot-father', 'work/clone/README.md');
  const own = await put(bots, 'bot-father', 'notes.md');

  await assertWorkOnlyIgnored(bots, work, own);
});

test('WI1 a bot made by bot create keeps its work folder out as well, as it always has', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');

  const work = await put(bots, 'api-bot', 'work/clone/README.md');
  const own = await put(bots, 'api-bot', 'notes.md');

  await assertWorkOnlyIgnored(bots, work, own);
});

/**
 * A bots folder as `init` left it before this change: the kit's ignore at the
 * root, holding only its skill links and its record of them, and nothing in Bot
 * Father's folder to keep `work/` out.
 */
async function madeBeforeThisChange(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');
  await writeFile(path.join(bots, '.gitignore'), [
    '# What obk links on this machine, rather than what this repo carries.',
    'bots/*/.claude/skills/*',
    'bots/*/.agents/skills/*',
    'bots/*/.obk-skills.yaml',
    '',
  ].join('\n'));
  await rm(path.join(botHomeOf(bots, 'bot-father'), '.gitignore'), { force: true });
  return bots;
}

test('WI2 init run again on a folder made before this change gives Bot Father\'s work folder the same ignore', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBeforeThisChange(box);
  const work = await put(bots, 'bot-father', 'work/clone/README.md');
  const own = await put(bots, 'bot-father', 'notes.md');
  assert.equal(await ignored(bots, work), false, 'the folder really is in the old state, or this proves nothing');

  const again = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(again.code, 0, again.stderr);
  await assertWorkOnlyIgnored(bots, work, own);
});

test('WI2 a .gitignore the user keeps in Bot Father\'s folder is left exactly as they wrote it', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBeforeThisChange(box);
  const theirs = path.join(botHomeOf(bots, 'bot-father'), '.gitignore');
  const mine = '# my own\n*.log\n';
  await writeFile(theirs, mine);

  const again = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(again.code, 0, again.stderr);
  assert.equal(await readFile(theirs, 'utf8'), mine, 'their file, byte for byte');
  // Their own ignore still works as they wrote it.
  const log = await put(bots, 'bot-father', 'debug.log');
  assert.equal(await ignored(bots, log), true);
});
