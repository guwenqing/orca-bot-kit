// A system test: Orca's request id on a consuming check, against the real Orca
// on this machine (#735). Run it with `npm run test:system -- --yes
// test/system/check-retry-request.test.js`; `npm test` cannot, and no CI
// machine could.
//
// From Orca 1.4.246 a plain `orca orchestration check` acknowledges the batch
// it hands over. When the kit gives up on a read that Orca answers late, Orca
// may have taken that batch as read, and the kit never showed it. Since #735
// each consuming read the kit makes carries `--retry-request <uuid>`, and a
// read that ran out of time is asked again with the same id. The design rests
// on one fact about Orca, read in its source (tags v1.4.245, v1.4.246 and
// v1.4.255) and modelled by the fake, and proven here, live:
//
//   1. A consuming check with a request id answers its batch with
//      `deliveryAcknowledged: true`.
//   2. The same command with the same id answers the same letters, under the
//      same delivery id, although Orca has marked them read by then (`orca
//      orchestration inbox` says `read: 1`).
//   3. A consuming check with a new id answers no letters.
//   4. `obk message check`, run from this checkout in the tab, exits 0 against
//      the real Orca, so Orca takes the kit's checks with `--retry-request`,
//      and shows the letters sent after the probe.
//
// What it cannot show: a read that Orca really answers too late. The real Orca
// cannot be made slow on purpose; the fake does that (test/message-check-retry.test.js).
//
// **No harness, so no first-run screen.** The test makes one Orca project of
// its own and opens one plain shell tab there: no Claude Code, no Codex. It
// types two lines into that tab, each a shell script of its own that it wrote
// in its throwaway folder, so every Orca call that must come from the tab
// (binding the Run, reading it) really comes from the tab's own shell, with
// the ORCA_TERMINAL_HANDLE and ORCA_TAB_ID Orca gave it. Nothing else is typed
// anywhere. A Claude bot is never started, so there is no folder trust to
// answer; if any screen in the tab shows a question (`questionOn`,
// helpers/screens.js), the run stops there and answers nothing.
//
// The bots folder is made by hand, not by `obk init`, which would bring Bot
// Father up in a Claude tab: one bot, `retry-probe`, whose book names the
// plain tab and the Run the tab made. That is all `obk message check` reads.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and Orca project Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by project path;
//   - closes its own tab by its handle (`--terminal <handle> --tab`) and then
//     removes its own Orca project, in that order;
//   - checks afterwards that it closed no tab it did not create.
//
// A Run cannot be deleted: Orca has no command for it. The one Run this test
// makes is left, named `obk system check-retry-request`, as every system test
// that makes a mailbox leaves its Runs. A minute or so.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';

import { cliEntry, shellWord } from '../helpers/cli.js';
import { questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { loadInWindow, makeProject, RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long a script typed into the tab is given to finish. */
const SCRIPT_MS = 90_000;

/** How long the new tab's shell is given to draw its first row. */
const SHELL_MS = 30_000;

/**
 * Ask Orca something and read its JSON. Never the blanket close, on any road.
 * Every tab it closes is counted as this test's, for the check at the end (#246).
 */
const guard = tabGuard(ORCA);
const { orca } = guard;

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one Orca project, by the path it was opened at. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/**
 * The tabs Orca lists at `home` once it has caught up with what was closed:
 * `terminal close` answers ok before `terminal list` stops reporting the tab.
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

/** Every Orca project Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** Keep asking until `look` gives something other than undefined, or the time runs out. */
async function until(what, within, look, note = () => '') {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** The rows the tab is rendering right now, or undefined when Orca rendered none. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const tail = answer.ok === true && answer.result?.terminal?.source === 'screen' ? answer.result.terminal.tail : undefined;
  return Array.isArray(tail) ? tail.map(String) : undefined;
}

/** What the tab is showing, for the message of a wait that ran out. */
const whatIsUp = (handle) => `\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`;

/** Stop the run when the tab shows a question: a plain shell asks none, and this test answers none. */
function askNothingIn(handle) {
  const rows = rowsOf(handle) ?? [];
  const question = questionOn(rows);
  assert.equal(question, undefined, `the plain tab shows a question, and this test answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

/**
 * Write `lines` as a shell script in `dir`, type one line into the tab that
 * runs it there, and wait until it has written its exit status. What it
 * printed goes to `<name>.out`. Typed once: a line that seems lost is not
 * typed again, so nothing runs twice.
 */
async function runInTab(handle, dir, name, lines) {
  const script = path.join(dir, `${name}.sh`);
  const out = path.join(dir, `${name}.out`);
  const status = path.join(dir, `${name}.status`);
  await writeFile(script, `${lines.join('\n')}\n`);
  const line = `/bin/sh ${shellWord(script)} > ${shellWord(out)} 2>&1; echo $? > ${shellWord(status)}`;
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', line, '--enter']);
  assert.equal(sent.ok, true, `typing into the test's own tab failed: ${JSON.stringify(sent.error)}`);
  const code = await until(`${name}.sh to finish in the tab`, SCRIPT_MS, async () => {
    askNothingIn(handle);
    if (!existsSync(status)) return undefined;
    const text = readFileSync(status, 'utf8').trim();
    return text === '' ? undefined : Number(text);
  }, () => whatIsUp(handle));
  const said = existsSync(out) ? readFileSync(out, 'utf8') : '';
  assert.equal(code, 0, `${name}.sh failed in the tab with exit ${code}:\n${said}`);
  return said;
}

/** One JSON answer a script wrote to `file`. */
function answerIn(file) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '(no file)';
  try {
    return JSON.parse(text);
  } catch {
    return assert.fail(`${path.basename(file)} is not JSON:\n${text}`);
  }
}

/** One Orca answer a script wrote to `file`, insisting it is ok. */
function okIn(file) {
  const answer = answerIn(file);
  assert.equal(answer.ok, true, `${path.basename(file)}: Orca refused it: ${JSON.stringify(answer.error ?? answer)}`);
  return answer.result;
}

/** Remove the throwaway bots folder and every `<bots>.*` the kit made beside it (PRD 6.3). */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));
  for (const name of await ours()) await rm(path.join(parent, name), { recursive: true, force: true });
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

const BOT = { name: 'retry-probe', display: 'Retry Probe' };

test('#735 a consuming check with a request id is answered again, the same batch, by the same id after Orca marked it read, and obk message check works with the flag', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-check-retry-')));
  const home = path.join(bots, 'bots', BOT.name);
  const homes = [home];
  const work = path.join(bots, 'probe');

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(placesOf(homes, allSetups(), bots));
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of projectsInBots(allSetups(), bots)) {
      if (before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    // Orca's sidebar keeps a deleted project's row until its window is rebuilt (#343).
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // 1. One bot folder, one Orca project there, and one plain shell tab in it,
  //    opened the way the kit opens a session's tab: no command, no focus.
  await mkdir(home, { recursive: true });
  await mkdir(work, { recursive: true });
  await writeFile(path.join(home, 'bot.yaml'), [
    `# ${BOT.display}: a bot made by hand for one system test run. It owns nothing.`,
    '',
    `name: ${BOT.name}`,
    'harness: claude',
    'sessions:',
    '  - name: daily',
    '',
  ].join('\n'));
  makeProject(home, BOT.display);
  const unloaded = loadInWindow(home);
  if (unloaded !== undefined) t.diagnostic(`Orca's window was not told to load the project: ${unloaded}`);
  const made = orca(['terminal', 'create', '--worktree', `path:${home}`, '--title', `${BOT.display} daily`]);
  assert.equal(made.ok, true, `opening the plain tab failed: ${JSON.stringify(made.error)}`);
  const tab = made.result.terminal;
  await until('the plain tab\'s shell to draw its prompt', SHELL_MS, async () => ((rowsOf(tab.handle) ?? []).some((row) => row.trim() !== '') ? true : undefined), () => whatIsUp(tab.handle));
  askNothingIn(tab.handle);

  // 2. In the tab: a Run of its own, bound to the tab.
  const file = (name) => path.join(work, name);
  const orcaWord = shellWord(ORCA);
  await runInTab(tab.handle, work, 'make-run', [
    `printf '%s\\n%s\\n' "$ORCA_TERMINAL_HANDLE" "$ORCA_TAB_ID" > ${shellWord(file('caller.txt'))}`,
    `${orcaWord} orchestration run-create --objective 'obk system check-retry-request' --from "$ORCA_TERMINAL_HANDLE" --full --json > ${shellWord(file('run.json'))}`,
  ]);
  const [callerHandle, callerTab] = readFileSync(file('caller.txt'), 'utf8').split('\n');
  assert.equal(callerHandle, tab.handle, 'the premise: the script ran in the test\'s own tab, as that tab\'s terminal');
  const run = okIn(file('run.json')).run;
  assert.match(String(run?.id), /^run_/, `Orca made a Run, got: ${JSON.stringify(run)}`);
  assert.equal(run.coordinator_handle, tab.handle, 'bound to the plain tab');

  // The book names the plain tab and its Run, as `up` and the mailbox step would.
  await writeFile(path.join(home, 'sessions.yaml'), [
    '# Written by hand by a system test: the plain tab and the Run it made.',
    'sessions:',
    '  daily:',
    `    tab: ${tab.tabId}`,
    `    mailbox: ${run.id}`,
    '',
  ].join('\n'));
  if (callerTab !== tab.tabId) t.diagnostic(`the tab's ORCA_TAB_ID is ${callerTab}, and terminal create answered ${tab.tabId}`);

  // 3. In the tab: three letters, the probe's three checks and the inbox look
  //    between them, two more letters, and the kit's own check. One line
  //    typed, before any letter: Orca's notice of mail lands in a tab that is
  //    already busy with the script.
  const tag = randomBytes(3).toString('hex');
  const subject = (n) => `retry probe ${tag} letter ${n}`;
  const [firstId, secondId] = [randomUUID(), randomUUID()];
  const consuming = (id, out) => `${orcaWord} orchestration check --run ${run.id} --terminal "$ORCA_TERMINAL_HANDLE" --retry-request ${id} --full --json > ${shellWord(file(out))}`;
  const send = (n) => `${orcaWord} orchestration send --to run:${run.id} --from run:${run.id} --subject ${shellWord(subject(n))} --body ${shellWord(`body ${n}`)} --full --json > ${shellWord(file(`send-${n}.json`))}`;
  const kit = [process.execPath, cliEntry].map(shellWord).join(' ');
  await runInTab(tab.handle, work, 'probe', [
    send(1),
    send(2),
    send(3),
    consuming(firstId, 'check-1.json'),
    `${orcaWord} orchestration inbox --terminal run:${run.id} --limit 20 --full --json > ${shellWord(file('inbox.json'))}`,
    consuming(firstId, 'check-2.json'),
    consuming(secondId, 'check-3.json'),
    send(4),
    send(5),
    `${kit} message check --bots ${shellWord(bots)} --bot ${BOT.name} --session daily --json > ${shellWord(file('obk-check.json'))} 2> ${shellWord(file('obk-check.err'))}`,
    `echo $? > ${shellWord(file('obk-check.status'))}`,
  ]);

  for (const n of [1, 2, 3, 4, 5]) okIn(file(`send-${n}.json`));
  const probe = [1, 2, 3].map(subject);

  // 1. The first read with a request id answers the batch and acknowledges it.
  const first = okIn(file('check-1.json'));
  assert.deepEqual(first.messages.map((message) => message.subject), probe, `the first read answers the three letters, got: ${JSON.stringify(first.messages)}`);
  assert.equal(first.deliveryAcknowledged, true, `and says Orca acknowledged them, got: ${JSON.stringify(first)}`);
  assert.equal(typeof first.deliveryId, 'string', `under a delivery id, got: ${JSON.stringify(first.deliveryId)}`);
  t.diagnostic(`the first read's mutation: ${JSON.stringify(first.mutation)}`);

  // Orca has marked them read.
  const inbox = okIn(file('inbox.json'));
  const marks = probe.map((one) => inbox.messages.find((message) => message.subject === one)?.read);
  assert.deepEqual(marks, [1, 1, 1], `the inbox says all three are read after the first read, got: ${JSON.stringify(marks)}`);

  // 2. The same id answers the same letters, under the same delivery, all the same.
  const again = okIn(file('check-2.json'));
  assert.deepEqual(again.messages.map((message) => message.id), first.messages.map((message) => message.id), `the same id answers the same letters, got: ${JSON.stringify(again.messages)}`);
  assert.equal(again.deliveryId, first.deliveryId, 'under the same delivery id');
  t.diagnostic(`the repeat's mutation: ${JSON.stringify(again.mutation)}`);

  // 3. A new id is a new read, and the batch is gone.
  const fresh = okIn(file('check-3.json'));
  assert.deepEqual(fresh.messages, [], `a read with a new id answers no letters, got: ${JSON.stringify(fresh.messages)}`);

  // 4. The kit's own check, in the tab, against the real Orca.
  const status = readFileSync(file('obk-check.status'), 'utf8').trim();
  const said = `${readFileSync(file('obk-check.json'), 'utf8')}${readFileSync(file('obk-check.err'), 'utf8')}`;
  assert.equal(status, '0', `obk message check exits 0 against the real Orca:\n${said}`);
  const shown = answerIn(file('obk-check.json')).messages.map((message) => message.subject);
  assert.deepEqual(shown, [subject(4), subject(5)], `it shows the two letters sent after the probe, and none of the probe's, got: ${JSON.stringify(shown)}`);
});
