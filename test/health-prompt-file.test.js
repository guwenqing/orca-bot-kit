// `obk health` does not call a session's own `prompt_file` a leftover (#577).
//
// Health reports a start-prompt file under `<bots>.prompts/` that no session
// answers to: kind 'leftover', `where` the file, and a sentence that says
// nothing reads it. A session in a bot's `bot.yaml` can name its own start
// prompt with `prompt_file`, and that file can sit under `<bots>.prompts/` too
// (a grooming run is written that way). The kit reads that file to start the
// session, so it is not a leftover, whatever it is called.
//
// The path is resolved the way the kit resolves it at launch: an absolute path
// as written, a relative one against the bot's own folder (`<bots>/bots/<bot>/`),
// never against the folder `obk` was run from. A prompt file that no session's
// name and no session's `prompt_file` points at is still a leftover, as before.
//
// No file used here is named after a session, so a file that health leaves
// alone is left alone because of `prompt_file`, not because of a session name.
//
// Everything goes through the CLI on a sandboxed bots folder, against the fake
// Orca, the way test/health.test.js does (H5 there is the case without
// `prompt_file`).

import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { botHomeOf, createSandbox } from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';

// ----------------------------------------------------------------- the fleet

/** A bots folder with Bot Father up in Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** One more bot with one plain session, added through the kit and brought up in Orca. */
async function botUp(box, name) {
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', name, '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots', '--bot', name]);
  assert.equal(up.code, 0, up.stderr);
  return botHomeOf(box.path('bots'), name);
}

/**
 * Add a session to one bot's `bot.yaml` by hand, the way a grooming run writes
 * one: its start prompt is the file `promptFile` names, spelled as given.
 * `extra` adds more settings to the entry, such as a `prompt` beside it.
 */
async function sessionWithPromptFile(bots, bot, name, promptFile, extra = {}) {
  const file = botYamlOf(bots, bot);
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  doc.sessions = [
    ...(doc.sessions ?? []),
    { name, harness: 'codex', prompt_file: promptFile, work_dir: `work/${name}`, ...extra },
  ];
  await writeFile(file, stringify(doc));
}

/** Write a start prompt at `file`, making the folders it needs. */
async function promptAt(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

// ---------------------------------------------------------------- the health check

/** Run the health check for JSON: findings, and exit 1 when there are any, 0 when none. */
async function found(box, ...rest) {
  const result = await box.run(['health', '--bots', 'bots', ...rest, '--json']);
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  assert.equal(result.code, answer.found.length === 0 ? 0 : 1, `exit code for ${answer.found.length} findings`);
  return answer;
}

/** The leftover findings. */
const leftovers = (answer) => answer.found.filter((one) => one.kind === 'leftover');

/** The findings that name `what` anywhere a reader would see it. */
const naming = (findings, what) => findings.filter((one) => `${one.where} ${one.says}`.includes(what));

const show = (value) => JSON.stringify(value, null, 2);

/** One finding names `what`: the file a person has to go and look at. */
function oneNaming(findings, what, why) {
  const said = naming(findings, what);
  assert.equal(said.length, 1, `${why}: one finding should name ${what}, got: ${show(findings)}`);
  return said[0];
}

/** No finding names `what`. */
function noneNaming(findings, what, why) {
  assert.deepEqual(naming(findings, what), [], `${why}: nothing should name ${what}, got: ${show(findings)}`);
}

// ---------------------------------------------------------------------------
// A session's configured prompt_file is not a leftover; an unowned file beside
// it, in the same run, still is.
// ---------------------------------------------------------------------------

const SESSION = 'groom-20261012-0230';

const CASES = [
  {
    label: 'an absolute prompt_file in the bot\'s own folder under <bots>.prompts',
    file: (bots) => path.join(`${bots}.prompts`, 'duty-bot', 'grooming-run.txt'),
    spell: (file) => file,
  },
  {
    label: 'a relative prompt_file, resolved against the bot\'s folder, in the bot\'s own folder under <bots>.prompts',
    file: (bots) => path.join(`${bots}.prompts`, 'duty-bot', 'grooming-run.txt'),
    spell: (file, home) => path.relative(home, file),
  },
  {
    label: 'an absolute prompt_file at the top of <bots>.prompts',
    file: (bots) => path.join(`${bots}.prompts`, 'grooming-run.txt'),
    spell: (file) => file,
  },
];

for (const { label, file: fileOf, spell } of CASES) {
  test(`#577 ${label} is not a leftover, and an unowned prompt file beside it still is`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const home = await botUp(box, 'duty-bot');

    const configured = await promptAt(fileOf(bots), 'Groom the fleet and report what you find.\n');
    const unowned = await promptAt(
      path.join(`${bots}.prompts`, 'duty-bot', 'old-run.txt'),
      'What a session I deleted was told to do.\n',
    );
    const spelled = spell(configured, home);
    if (spelled !== configured) {
      assert.ok(!path.isAbsolute(spelled), `this case writes a relative path, got: ${spelled}`);
      assert.equal(path.resolve(home, spelled), configured, 'the relative path leads from the bot folder to the file');
    }
    await sessionWithPromptFile(bots, 'duty-bot', SESSION, spelled);

    const answer = await found(box);

    oneNaming(leftovers(answer), unowned, 'no session is called old-run, and no prompt_file points at it');
    noneNaming(
      leftovers(answer),
      configured,
      `the session ${SESSION} names this file as its prompt_file, and the kit reads it to start the session`,
    );
  });
}

test('#577 a relative prompt_file is resolved against the bot\'s folder, not the folder obk ran from', async (t) => {
  // Resolved against the folder `obk` was run from, this path leads to the
  // file. Resolved against the bot's folder, as the kit does at launch, it
  // leads nowhere, so no session reads the file and it is still a leftover.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const home = await botUp(box, 'duty-bot');

  const file = await promptAt(path.join(`${bots}.prompts`, 'duty-bot', 'grooming-run.txt'), 'Groom the fleet.\n');
  const spelled = path.relative(box.cwd, file);
  assert.equal(path.resolve(box.cwd, spelled), file, 'from the run folder, the path leads to the file');
  assert.notEqual(path.resolve(home, spelled), file, 'from the bot folder, the path leads somewhere else');
  await sessionWithPromptFile(bots, 'duty-bot', SESSION, spelled);

  const answer = await found(box);

  oneNaming(leftovers(answer), file, 'the kit would read the prompt from another path, so nothing reads this file');
});

// ---------------------------------------------------------------------------
// A prompt_file that is not a string path does not make health lose the other
// prompt leftovers (review of PR #593). What health says about the session
// itself is not pinned here; what is pinned is that an unowned prompt file is
// still a leftover in the same run, in a run for the whole fleet and in a run
// for another bot.
// ---------------------------------------------------------------------------

const NOT_A_PATH = [
  {
    label: 'a prompt_file of 42, in a run for the whole fleet',
    extra: {},
    unownedIn: 'duty-bot',
    run: [],
  },
  {
    label: 'a prompt_file of 42 beside a prompt, in a run for the whole fleet',
    extra: { prompt: 'Groom the fleet.' },
    unownedIn: 'duty-bot',
    run: [],
  },
  {
    label: 'a prompt_file of 42 in another bot, in a run for Bot Father only',
    extra: {},
    unownedIn: 'bot-father',
    run: ['--bot', 'bot-father'],
  },
];

for (const { label, extra, unownedIn, run } of NOT_A_PATH) {
  test(`#577 ${label} does not hide an unowned prompt file`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'duty-bot');
    const unowned = await promptAt(
      path.join(`${bots}.prompts`, unownedIn, 'old-run.txt'),
      'What a session I deleted was told to do.\n',
    );
    // The same run before the session is written: the unowned file is a
    // leftover there, so a run that loses it below lost it to the session.
    oneNaming(leftovers(await found(box, ...run)), unowned, 'before the session with a prompt_file of 42 is written');

    await sessionWithPromptFile(bots, 'duty-bot', SESSION, 42, extra);

    const answer = await found(box, ...run);

    oneNaming(leftovers(answer), unowned, 'no session is called old-run, and no prompt_file points at it');
  });
}

// ---------------------------------------------------------------------------
// A prompt_file reached through a symlink: the kit reads the file the link
// leads to, so that file is not a leftover (review of PR #593).
// ---------------------------------------------------------------------------

const THROUGH_A_LINK = [
  {
    label: 'a file in the bot\'s folder that links to the prompt file',
    async lay(home, target) {
      await mkdir(path.join(home, 'prompts'), { recursive: true });
      await symlink(target, path.join(home, 'prompts', 'groom.txt'));
      return path.join('prompts', 'groom.txt');
    },
  },
  {
    label: 'a folder in the bot\'s folder that links to the folder the prompt file is in',
    async lay(home, target) {
      await symlink(path.dirname(target), path.join(home, 'prompts'));
      return path.join('prompts', path.basename(target));
    },
  },
];

for (const { label, lay } of THROUGH_A_LINK) {
  test(`#577 a prompt_file through ${label} keeps that prompt file off the leftovers`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const home = await botUp(box, 'duty-bot');

    const target = await promptAt(path.join(`${bots}.prompts`, 'grooming-run.txt'), 'Groom the fleet.\n');
    const unowned = await promptAt(
      path.join(`${bots}.prompts`, 'duty-bot', 'old-run.txt'),
      'What a session I deleted was told to do.\n',
    );
    const spelled = await lay(home, target);
    assert.equal(
      await realpath(path.resolve(home, spelled)),
      await realpath(target),
      'from the bot folder, the path leads through the link to the prompt file',
    );
    await sessionWithPromptFile(bots, 'duty-bot', SESSION, spelled);

    const answer = await found(box);

    oneNaming(leftovers(answer), unowned, 'no session is called old-run, and no prompt_file points at it');
    noneNaming(
      leftovers(answer),
      target,
      `the session ${SESSION} reads this file through the link its prompt_file names`,
    );
  });
}
