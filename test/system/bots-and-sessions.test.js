// A system test: two bots the kit made, on the two real harnesses, in the real
// Orca on this machine. Run it with `npm run test:system`; `npm test` cannot,
// and no CI machine could.
//
// It is the live check for the one thing the fake Orca cannot answer: whether
// the launch line the kit types — flags and start prompt together — is a line
// the harness accepts. A flag named wrongly does not fail loudly: the harness
// prints its usage and exits, the tab falls back to a shell, and no TUI ever
// comes up. So a session that comes up at all is the proof, and this test
// insists on it for both harnesses.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the Bot Father one beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and deletes
//     its own workspaces, whatever happened, and checks afterwards that every
//     terminal that was there before is still there.
//
// `orca terminal close --worktree … --all` is never run here. It would take
// away tabs, layouts and resume records that belong to the person at the
// keyboard. The helper below refuses to run it at all.
//
// It keeps to one Claude bot and one Codex bot. Each one starts a real harness
// on the owner's machine, and two is enough to check both mappings.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { mkdtemp, readdir, readFile, readlink, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

/**
 * Remove the throwaway bots folder and everything the kit made beside it.
 *
 * `<bots>.prompts`, where a session's start prompt goes, is a **sibling** of the
 * bots folder and not a child of it (PRD 6.3 keeps kit-made folders out of the
 * user's repo), so a teardown that removes `<bots>` alone leaves the sessions'
 * duty text on the disk of whoever ran the test. Anything else the kit ever
 * puts beside it is named the same way, so this takes the folder and every
 * `<bots>.*` next to it, and then says so if one is still there.
 */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));

  for (const name of await ours()) {
    await rm(path.join(parent, name), { recursive: true, force: true });
  }
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** Ask Orca something and read its JSON. Never the blanket close, on any road. */
function orca(args) {
  assert.ok(
    !(args.includes('--all') && args.includes('close')),
    `refusing to run \`orca ${args.join(' ')}\`: it would take away someone else's tabs`,
  );
  const done = spawnSync(ORCA, [...args, '--json'], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.message}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`orca ${args.join(' ')} did not answer JSON: ${done.stdout}${done.stderr}`);
  }
  return answer;
}

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/**
 * The tabs Orca lists at `home` once it has caught up with what was closed.
 * `terminal close` answers ok before `terminal list` stops reporting the tab —
 * seen live, for a second or two on a busy machine, and a second close of the
 * same handle then fails with `terminal_handle_stale`. So the listing is read
 * again until the closed tabs are out of it, rather than read once and
 * believed. What comes back when the wait runs out is whatever Orca still
 * says, for the assertion to fail on.
 *
 * By handle: a raw listing can show a tab under `pty:<ptyId>` rather than its
 * id while Orca calls it orphaned, and the handle is the same either way (#187).
 */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

/**
 * The id Orca gave a tab, read by its handle. `terminal show` answers the real
 * id even while `terminal list` shows the tab as `pty:<ptyId>` (#187), so this
 * is what a check of "the kit reported the id Orca gave" compares against.
 */
function realTabId(handle) {
  const answer = orca(['terminal', 'show', '--terminal', handle]);
  assert.equal(answer.ok, true, `orca terminal show failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminal.tabId;
}

/** Every workspace Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** Run the real `obk`, the one `npm link` put on PATH. */
function obk(args) {
  const done = spawnSync('obk', args, { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}: run \`npm link\` in this repo first`);
  // The owner reads this output. Orca's word for a workspace must not be in it.
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return JSON.parse(done.stdout);
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** The two bots this test makes, and what each one should come up as. */
const BOTS = [
  {
    name: 'claude-bot',
    harness: 'claude',
    display: 'Claude Bot',
    prompt: 'You are the system test\'s Claude bot. Say nothing and wait.',
  },
  {
    name: 'codex-bot',
    harness: 'codex',
    display: 'Codex Bot',
    prompt: 'You are the system test\'s Codex bot. Say nothing and wait.',
  },
];

test('two bots on the two harnesses come up in the real Orca, and nothing else is touched', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-fleet-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  // Bot Father's home included: `init` brings it up, and what this test made it
  // must also take away.
  const homes = ['bot-father', ...BOTS.map((bot) => bot.name)].map(homeOf);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const closed = [];
    for (const home of homes) {
      for (const terminal of terminalsAt(home)) {
        if (before.handles.has(terminal.handle)) continue;
        orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
        closed.push(terminal.handle);
      }
    }
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    await removeBotsFolderAndSiblings(bots);

    // The point of all the care above: everything that was open is still open.
    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
  });

  // 1. The bots folder, and Bot Father with it.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);

  // 2. One bot per harness, each with a start prompt and a work dir.
  for (const bot of BOTS) {
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot.name, '--harness', bot.harness,
      '--charter', `${bot.display} exists for one system test run and owns nothing.`,
    ]);
    obkJson([
      'session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'daily',
      '--prompt', bot.prompt, '--work-dir', 'work/notes',
    ]);
  }

  // What `bot create` wrote is on disk as the kit says it is.
  for (const bot of BOTS) {
    const home = homeOf(bot.name);
    const config = parse(await readFile(path.join(home, 'bot.yaml'), 'utf8'));
    assert.equal(config.name, bot.name);
    assert.equal(config.harness, bot.harness);
    assert.deepEqual(config.sessions, [
      { name: 'daily', approval: 'auto', prompt: config.sessions[0].prompt, work_dir: 'work/notes' },
    ]);
    assert.equal(config.sessions[0].prompt.trim(), bot.prompt);

    const agents = await readFile(path.join(home, 'AGENTS.md'), 'utf8');
    assert.ok(agents.includes(bot.display), `AGENTS.md should hold the charter: ${agents}`);
    assert.ok(lstatSync(path.join(home, 'CLAUDE.md')).isSymbolicLink(), 'CLAUDE.md is a symlink');
    assert.equal(await readlink(path.join(home, 'CLAUDE.md')), 'AGENTS.md');
    assert.match(await readFile(path.join(home, '.gitignore'), 'utf8'), /^work\/$/m);
  }

  // 3. Up, one bot at a time, so nothing but these two is started.
  for (const bot of BOTS) {
    const home = homeOf(bot.name);
    const answer = obkJson(['up', '--bots', bots, '--bot', bot.name]);

    const setups = allSetups().filter((setup) => setup.path === home);
    assert.equal(setups.length, 1, `Orca should hold one workspace for ${home}, got ${JSON.stringify(setups)}`);
    assert.equal(setups[0].kind, 'folder', 'a git-kind workspace has no place to open a tab in');
    assert.equal(setups[0].displayName, bot.display);

    const opened = terminalsAt(home);
    assert.equal(opened.length, 1, `${bot.name} has its one session tab, got ${JSON.stringify(opened)}`);
    assert.equal(before.handles.has(opened[0].handle), false, 'the tab should be a new one');

    // What Orca calls the tab now is not checked, here or anywhere: Orca
    // reports whatever the program in the tab last wrote, and Claude Code
    // writes its own title over the kit's within seconds of starting (tech
    // notes, section 1). The kit sets the title and never reads one back —
    // the tab id is the key (PRD 6.2) — so the title is only ever the kit's
    // own claim, checked below in what it answered.

    // What it reported is what Orca really has. No ops tab: that is Bot
    // Father's alone.
    assert.deepEqual((answer.tabs ?? []).map((entry) => entry.name), ['daily']);
    const entry = tabOf(answer, 'daily');
    assert.equal(entry.bot, bot.name);
    assert.equal(entry.created, true);
    assert.equal(entry.terminal, opened[0].handle);
    assert.equal(entry.tabId, realTabId(opened[0].handle), 'the id Orca gave the tab');
    assert.equal(entry.title, `${bot.display} daily`);

    // The live check this whole file exists for: the flags PRD 6.4 maps the
    // session's settings to are flags this harness takes. A wrong one and
    // `${bot.harness}` prints its usage, exits, and no TUI ever comes up here.
    assert.equal(
      entry.harnessStarted,
      true,
      `no ${bot.harness} came up in ${entry.title}: look at it with `
      + `\`orca terminal read --terminal ${entry.terminal} --screen\``,
    );

    // The work dir was made before the session was told about it.
    assert.ok((await stat(path.join(home, 'work', 'notes'))).isDirectory(), 'the work dir should be there');

    // The start prompt rode in on the launch line, as the harness's own prompt
    // argument. The harness holds it until it is ready — behind its folder-trust
    // question on this first run — which is why there is no second send to get
    // wrong. A line the harness took is a prompt the harness has.
    assert.equal(entry.promptSent, true, 'the prompt went in with the line that started the harness');
  }

  // 4. A second run makes nothing and types nothing.
  for (const bot of BOTS) {
    const opened = terminalsAt(homeOf(bot.name)).map((terminal) => terminal.handle);
    const again = obkJson(['up', '--bots', bots, '--bot', bot.name]);

    assert.deepEqual(
      terminalsAt(homeOf(bot.name)).map((terminal) => terminal.handle),
      opened,
      'a second run should have left the tab exactly as it was',
    );
    const entry = tabOf(again, 'daily');
    assert.equal(entry.created, false, 'a second run makes nothing');
    assert.equal(entry.harnessStarted, false, 'this run typed into nothing and looked at nothing');
    assert.equal('promptSent' in entry, false, 'and told the session nothing, so has nothing to report');
  }
});
