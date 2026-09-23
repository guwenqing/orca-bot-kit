// A system test: `obk groom` against the real Orca on this machine. Run it with
// `npm run test:system -- --yes`; `npm test` cannot, and no CI machine could.
//
// It is the part of PRD 4.10 that Orca decides, and nothing more (issue #157).
// The grooming run itself is an agent writing a report, which is judged by a
// person reading it, not by a test. What a test can pin is the one thing
// `src/groom.js` says it must get right: there is never more than one. Orca does
// not deduplicate an automation by name — asked twice, it makes two — so the
// kit looks for its own before it creates anything. The unit tests prove that
// against a fake Orca; only the real one can say whether what the kit looks for
// is what Orca actually lists.
//
// So this asks Orca itself, not `obk`: the automations that are new since the
// test began and that belong to this run's own Bot Father. Exactly one after
// the first `obk groom --at`, switched off, and still exactly the same one
// after the second.
//
// No agent runs and no tokens are spent. The automation is made off and removed
// again; `obk init` does start Bot Father's harness in its tab, which sits on
// its first screen unanswered until the tab is closed.
//
// The machine it runs on is someone's working machine, with their own tabs and
// perhaps their own automations. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal, workspace and automation Orca already had,
//     before it creates anything;
//   - removes only automations that are new since then **and** belong to this
//     run's own folder, closes its own tabs one by one, and deletes its own
//     workspace, whatever happened;
//   - checks afterwards that everything that was there before is still there.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

/** Remove the throwaway bots folder and everything the kit made beside it. */
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

function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/** The tabs Orca lists at `home` once it has caught up with what was closed. */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.tabId)) && Date.now() < until) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** Every automation Orca knows about right now, as Orca lists it. */
function allAutomations() {
  const answer = orca(['automations', 'list']);
  assert.equal(answer.ok, true, `orca automations list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.automations ?? [];
}

/**
 * The automations that are new since `before` and belong to `home`.
 *
 * "Belongs" is read off the whole entry rather than one field, so this does not
 * share the kit's own idea of where Orca keeps an automation's folder: if the
 * kit is looking in the wrong field, this still finds the automation it made,
 * and the count says so.
 */
const newAt = (before, home) =>
  allAutomations().filter((one) => !before.has(one.id) && JSON.stringify(one).includes(home));

/** Run the real `obk`, the one `npm link` put on PATH. */
function obk(args) {
  const done = spawnSync('obk', args, { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}: run \`npm link\` in this repo first`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return JSON.parse(done.stdout);
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

test('obk groom makes one grooming, switched off, and asking again makes no second', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
    automations: new Set(allAutomations().map((one) => one.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-groom-')));
  const home = path.join(bots, 'bots', 'bot-father');

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    for (const one of newAt(before.automations, home)) {
      orca(['automations', 'remove', '--id', one.id]);
    }
    const closed = [];
    for (const terminal of terminalsAt(home)) {
      if (before.handles.has(terminal.handle)) continue;
      orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
      closed.push(terminal.tabId);
    }
    for (const setup of allSetups()) {
      if (setup.path !== home || before.setups.has(setup.id)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    await removeBotsFolderAndSiblings(bots);

    // Everything that was there before is still there, and nothing of ours is.
    const handles = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(handles.has(handle), `${handle} was open before this test and is gone now`);
    }
    const automations = new Set(allAutomations().map((one) => one.id));
    for (const id of before.automations) {
      assert.ok(automations.has(id), `automation ${id} was there before this test and is gone now`);
    }
    assert.deepEqual(newAt(before.automations, home), [], 'this test left an automation behind');
    assert.deepEqual(await terminalsAfterClosing(home, closed), [], 'this test left tabs behind');
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  assert.deepEqual(newAt(before.automations, home), [], 'init makes no grooming; only obk groom --at does');

  // The first ask makes it, and makes it off.
  const first = obkJson(['groom', '--bots', bots, '--at', '04:00']).groom;
  assert.equal(first.exists, true, `obk groom --at should have made the grooming, got: ${JSON.stringify(first)}`);
  assert.equal(first.enabled, false, 'it is made off: it spends tokens every day, and waits for one explicit yes');
  assert.equal(first.at, '04:00');

  // And Orca agrees, which is the part only a real Orca can say.
  const made = newAt(before.automations, home);
  assert.equal(made.length, 1, `Orca should hold exactly one grooming for this Bot Father, got: ${JSON.stringify(made)}`);
  assert.equal(made[0].id, first.id, 'the one obk reports is the one Orca holds');
  assert.equal(made[0].enabled, false, `Orca should hold it switched off, got: ${JSON.stringify(made[0])}`);

  // The second ask finds it rather than making another. This is the whole of
  // what the kit's looking is for: Orca itself would make a second.
  const second = obkJson(['groom', '--bots', bots, '--at', '04:00']).groom;
  assert.equal(second.id, first.id, 'asking again should find the grooming it made, not make another');
  const still = newAt(before.automations, home);
  assert.equal(still.length, 1, `asking again should leave exactly one grooming, got: ${JSON.stringify(still)}`);
  assert.equal(still[0].id, first.id);
});
