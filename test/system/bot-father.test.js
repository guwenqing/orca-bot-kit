// A system test: the real `obk` against the real Orca on this machine. Run it
// with `npm run test:system`; `npm test` cannot, and no CI machine could.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by worktree path;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and deletes
//     its own workspace, whatever happened, and checks afterwards that every
//     terminal that was there before is still there.
//
// `orca terminal close --worktree … --all` is never run here. It would take
// away tabs, layouts and resume records that belong to the person at the
// keyboard. The helper below refuses to run it at all.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { sessionTabIds } from '../helpers/cli.js';

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

/** The terminals in one worktree, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

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

test('Bot Father comes up in the real Orca, and nothing else is touched', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-bots-')));
  const home = path.join(bots, 'bots', 'bot-father');

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    for (const terminal of terminalsAt(home)) {
      if (before.handles.has(terminal.handle)) continue;
      orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
    }
    for (const setup of allSetups()) {
      if (setup.path !== home || before.setups.has(setup.id)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    await rm(bots, { recursive: true, force: true });

    // The point of all the care above: everything that was open is still open.
    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    assert.deepEqual(terminalsAt(home), [], 'this test left tabs behind');
  });

  // 1. init: the folder is seeded and Bot Father appears in Orca. This is also
  // where a kit that started the tab with `--command claude` would fail: Orca
  // times out waiting for the handle and the tab never becomes live.
  const init = obkJson(['init', '--bots', bots, '--harness', 'claude']);

  const setups = allSetups().filter((setup) => setup.path === home);
  assert.equal(setups.length, 1, `Orca should hold one workspace for ${home}, got ${JSON.stringify(setups)}`);
  assert.equal(setups[0].kind, 'folder', 'a git-kind workspace has no worktree to open a tab in');
  assert.equal(setups[0].displayName, 'Bot Father');

  const opened = terminalsAt(home);
  assert.equal(opened.length, 2, `Bot Father has a daily tab and an ops tab, got ${JSON.stringify(opened)}`);
  for (const terminal of opened) {
    assert.equal(before.handles.has(terminal.handle), false, 'the tabs should be new ones');
  }

  // What it reported is what Orca really has.
  // The session is named; the plain tab beside it is not, because the kit
  // keeps nothing about it and could not tell it from a tab the user opened.
  assert.deepEqual((init.tabs ?? []).map((entry) => entry.name).sort(), ['daily', null]);
  for (const name of ['daily', null]) {
    const entry = tabOf(init, name);
    const real = opened.find((terminal) => terminal.handle === entry.terminal);
    assert.ok(real, `the ${name} tab's handle should be one Orca lists: ${JSON.stringify(entry)}`);
    assert.equal(entry.tabId, real.tabId);
    assert.equal(entry.bot, 'bot-father');
    assert.equal(entry.title, name === 'daily' ? 'Bot Father daily' : 'Bot Father ops');
    assert.equal(entry.created, true);
  }
  assert.equal(tabOf(init, null).harnessStarted, false, 'nothing is typed into a plain shell');
  assert.equal(
    typeof tabOf(init, 'daily').harnessStarted,
    'boolean',
    'the daily tab says whether its harness came up; either way the run succeeded',
  );

  // 2. the book: the Orca project and the daily session's tab id. The plain tab
  // is not in it, and not kept anywhere else either.
  const book = path.join(home, 'sessions.yaml');
  assert.ok(existsSync(book), `${book} should hold the ids Orca gave`);
  const recorded = await readFile(book, 'utf8');
  assert.ok(recorded.includes(setups[0].id), `the Orca project id should be in the book: ${recorded}`);

  const { sessions } = sessionTabIds(recorded);
  assert.ok(
    sessions.has(tabOf(init, 'daily').tabId),
    `the daily tab id should sit under a session: ${recorded}`,
  );
  assert.ok(
    !recorded.includes(tabOf(init, null).tabId),
    `the tab outside the book must not be written down: ${recorded}`,
  );

  // It is an ordinary file of the bots repo, committed like the rest.
  const ignored = spawnSync('git', ['-C', bots, 'check-ignore', '--no-index', '--quiet', 'bots/bot-father/sessions.yaml']);
  assert.equal(ignored.status, 1, 'the book belongs in the repo');

  // 3. up again: nothing created, nothing closed, nothing typed.
  const again = obkJson(['up', '--bots', bots]);
  assert.deepEqual(
    terminalsAt(home).map((terminal) => terminal.tabId).sort(),
    opened.map((terminal) => terminal.tabId).sort(),
    'a second run should have left the tabs exactly as they were',
  );
  for (const name of ['daily', null]) {
    assert.equal(tabOf(again, name).created, false, 'a second run makes nothing');
    assert.equal(tabOf(again, name).harnessStarted, false, 'this run typed into nothing and looked at nothing');
    assert.equal(tabOf(again, name).tabId, tabOf(init, name).tabId);
  }

  // 4. the daily session the user closed comes back, with a new id, and the
  // plain tab beside it is left alone — it is what keeps a second one from
  // being made.
  const closed = opened.find((terminal) => terminal.handle === tabOf(init, 'daily').terminal);
  const kept = opened.find((terminal) => terminal.handle === tabOf(init, null).terminal);
  assert.ok(closed && kept, 'the run should have reported both tabs');
  orca(['terminal', 'close', '--terminal', closed.handle, '--tab']);
  assert.deepEqual(
    terminalsAt(home).map((terminal) => terminal.tabId),
    [kept.tabId],
    'the fixture itself should have closed exactly one tab',
  );

  const recovered = obkJson(['up', '--bots', bots]);

  const back = terminalsAt(home);
  assert.equal(back.length, 2, `the closed tab should be back, got ${JSON.stringify(back)}`);
  assert.ok(back.some((terminal) => terminal.tabId === kept.tabId), 'the live tab should have been left alone');
  const fresh = back.filter((terminal) => terminal.tabId !== kept.tabId);
  assert.equal(fresh.length, 1);
  assert.notEqual(fresh[0].tabId, closed.tabId, 'a tab that came back is a new tab with a new id');

  const remade = (recovered.tabs ?? []).filter((entry) => entry.created === true);
  assert.equal(remade.length, 1, `one tab was made again, got: ${JSON.stringify(recovered.tabs)}`);
  assert.equal(remade[0].tabId, fresh[0].tabId, 'and it reported the id Orca gave it');
});
