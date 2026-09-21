// A system test: two bots the kit made, on the two real harnesses, writing to
// each other through the real Orca mailbox on this machine. Run it with
// `npm run test:system`; `npm test` cannot, and no CI machine could.
//
// It is the live check for the three things the fake Orca cannot answer:
//
//   1. A Claude bot and a Codex bot exchange a message and a reply. Every part
//      of that is real: the Run mailbox each session was given at `up`, the
//      message queued into it, the line typed into the receiver's tab — the
//      only thing that reaches a harness, because the mailbox is pull-only —
//      the harness reading its own mail with `obk message check`, and the
//      reply coming back the other way with the thread on it.
//   2. A busy receiver is not interrupted (PRD 6.9). The nudge is typed into a
//      tab that is in the middle of something; both harnesses take a typed
//      line as the next turn rather than cutting into the one they are having,
//      so the work that was running finishes first and the mail is read after.
//   3. A long, oddly formatted message arrives unchanged. Above 4 KiB the body
//      is written to a file beside the bots folder and the message names it,
//      so what has to survive is the file's bytes and the naming of it,
//      through Orca's own store and back.
//
// What the fake Orca cannot say about any of it: whether the fields the kit
// reads out of `orchestration check` are the fields Orca really answers with.
// The kit reads `from_handle`, `thread_id`, `created_at` and the delivery to
// acknowledge; a fake can only agree with whoever wrote it. Case 3 below is
// what settles that, because it reads a real message back out of a real
// mailbox and compares it with what was sent.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the others beside it:
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
// One thing this test cannot clean up, and says so rather than hiding it: the
// Run mailboxes. Orca has no `run-delete`, and `orchestration reset --messages`
// would empty the whole machine's mailbox, which the kit never runs and neither
// does this. So each run of this file leaves two or three Runs behind, named
// `obk <bot>/<session>`, belonging to a bots folder that no longer exists. They
// are listed by `orca orchestration run-list` and can be ignored.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them —
// answering them is the caller's job and not the kit's (PRD 6.5). On this
// machine a first run asks for Claude Code's folder trust (the selection starts
// on `No, exit`, so it takes a down-arrow and then return), Codex's directory
// trust (`1. Yes, continue`), Codex's `Hooks need review` (`2`, "Trust all and
// continue" — without it the kit's hook never runs) and possibly a harness
// update offer. Every wait below says what the tab is showing when it runs out
// of patience, so a run that was left alone names the screen that stopped it.
//
// It is slow: two real agents, a round trip between them, and a long task in
// the middle. Minutes, not seconds.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

/**
 * Remove the throwaway bots folder and everything the kit made beside it.
 *
 * What the kit writes for itself is a **sibling** of the bots folder and not a
 * child of it (PRD 6.3): `<bots>.prompts` for start prompts, and the file a
 * long message's body goes to. A teardown that removes `<bots>` alone leaves
 * both on the disk of whoever ran the test.
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

/** How long a real agent is given to do something before the test gives up on it. */
const ANSWER_MS = 240000;

/** And how long a round trip between two agents is given: two turns and a nudge in between. */
const ROUND_TRIP_MS = 480000;

/**
 * How long a tab is given to be ready for a line of ours. A first run has two
 * or three screens on it and a person answering them.
 */
const READY_MS = 180000;

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
 * seen live on a busy machine — so the listing is read again until the closed
 * tabs are out of it rather than read once and believed.
 */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.tabId)) && Date.now() < until) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
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

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out. `note` is added to the message when it does, so a run left alone
 * says which screen was waiting rather than only that it waited.
 */
async function until(what, within, look, note = () => '') {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** Everything the tab is rendering right now, as one piece of text to look through. */
function screenOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  return answer.ok === true ? JSON.stringify(answer.result) : '';
}

/**
 * What the tab is showing, for the message of a wait that ran out: Orca's own
 * word for whatever is waiting to be answered when it gave one, and then the
 * screen itself, which is the only thing that catches the rest.
 */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/**
 * Wait until the tab will take a line of ours: a TUI is up, so nothing is
 * swallowed by a shell, and the tab is not waiting on a screen of its own.
 * Orca refuses an agent prompt to a tab that is itself on a prompt, so a test
 * that asked as soon as a TUI answered would be asking through the trust
 * question and could never land.
 */
async function readyForAQuestion(handle, within = READY_MS) {
  await until(
    `${handle} to be past the questions of its own`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true) return undefined;
      return answer.result?.wait?.blockedReason === undefined ? true : undefined;
    },
    () => whatIsUp(handle),
  );
}

/** How long Orca is given to submit a line it gated, on the one re-issue it asks for. */
const SUBMIT_S = 30;

/**
 * Ask a live agent something, once the tab is ready to take a line: the text,
 * and `--enter` to submit it. `--enter` is what submits, and only `--enter`: a
 * return inside the payload is a newline in a composer, and three questions
 * sent that way once piled up unsent in one draft.
 *
 * Orca gates a line as an agent prompt when it will not take one yet: `ok:false`,
 * `agent_prompt_blocked`, a request id in the error, and its own instruction to
 * re-issue the exact command with that id rather than retry it plain. Seen twice
 * in this file, both times on the first line into a Claude tab a moment after
 * the harness came up, and never on the kit's own nudge; what sets it off is not
 * known. So the one thing done about it is the one thing Orca sanctions, once:
 * the same command again with the id and `--wait-submit`, which is Orca holding
 * the line until the tab will take it. A wait of our own would only be guessing
 * at the same thing from outside.
 */
async function askIn(handle, text) {
  await readyForAQuestion(handle);
  const send = ['terminal', 'send', '--terminal', handle, '--text', text, '--enter'];
  const sent = orca(send);
  if (sent.ok === true) return;

  const gated = requestIdIn(sent.error);
  if (gated !== undefined) {
    const again = orca([...send, '--retry-request', gated, '--wait-submit', String(SUBMIT_S)]);
    if (again.ok === true) return;
    assert.fail(
      `orca gated this line as an agent prompt (${JSON.stringify(sent.error)}) and refused the re-issue`
      + ` it asked for as well (${JSON.stringify(again.error)}). Submit the line yourself in the tab:`
      + ` this is where it ends, because whether a prompt goes in is the person's (PRD 6.5).${whatIsUp(handle)}`,
    );
  }

  assert.fail(`orca terminal send --enter failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
}

/** The request id an `agent_prompt_blocked` carries, when that is what came back. */
function requestIdIn(error) {
  const found = /"orchestrationRequestId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(error ?? null));
  return found === null ? undefined : found[1];
}

/** Wait for a word to show up on a tab's screen, whoever put it there. */
const showsUp = (handle, word, within = ANSWER_MS) => until(
  `${word} to show up in ${handle}`,
  within,
  async () => (screenOf(handle).includes(word) ? true : undefined),
  () => whatIsUp(handle),
);

/** Ask the session something and wait for `word` to appear on its screen. */
async function answers(handle, question, word, within = ANSWER_MS) {
  await askIn(handle, question);
  await showsUp(handle, word, within);
}

/**
 * The two bots. Each one is told in its start prompt what to do when fleet mail
 * arrives, because that is what the nudge counts on: a line saying mail is
 * waiting, and a session that knows to go and read it.
 */
const BOTS = [
  { name: 'mail-claude', harness: 'claude', display: 'Mail Claude' },
  { name: 'mail-codex', harness: 'codex', display: 'Mail Codex' },
];

const startPromptFor = (bots) => [
  'You are a system test\'s bot and you own nothing.',
  'When a line arrives saying fleet mail is waiting, run exactly the command that line names to read it,',
  'and then print, on one line each, the words WHO: followed by who it is from, THREAD: followed by the thread id,',
  'and MAIL: followed by the text of the message.',
  'If the message asks you to reply, reply by running the obk message send command it gives you, word for word.',
  `Your bots folder is ${bots}.`,
  'Do nothing else at all: run no other command, read no file, and write nothing.',
  'Say nothing now and wait.',
].join(' ');

/** Everything this test made, taken away again, and a check that nothing else was. */
function cleanUpAfter(t, { before, bots, homes }) {
  t.after(async () => {
    const closed = [];
    for (const home of homes) {
      for (const terminal of terminalsAt(home)) {
        if (before.handles.has(terminal.handle)) continue;
        orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
        closed.push(terminal.tabId);
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
}

/** A throwaway fleet: Bot Father, a Claude bot and a Codex bot, each with one session up. */
async function aFleet(t, label) {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };
  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), `obk-system-${label}-`)));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', ...BOTS.map((bot) => bot.name)].map(homeOf);

  // Registered before anything is created, so it runs however the test ends.
  cleanUpAfter(t, { before, bots, homes });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);

  const tabs = {};
  for (const bot of BOTS) {
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot.name, '--harness', bot.harness,
      '--charter', `${bot.display} exists for one system test run and owns nothing.`,
    ]);
    obkJson([
      'session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'daily',
      `--prompt=${startPromptFor(bots)}`,
    ]);

    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name]), 'daily');
    assert.equal(entry.created, true);
    assert.equal(
      entry.harnessStarted,
      true,
      `no ${bot.harness} came up in ${entry.title}: look at it with `
      + `\`orca terminal read --terminal ${entry.terminal} --screen\``,
    );

    // The address book, live: `up` gave the session a Run of its own and wrote
    // it down, and a Claude session carries its name as well.
    const session = await sessionIn(homeOf(bot.name), 'daily');
    assert.match(String(session.mailbox), /^run_/, `${bot.name} should have a Run mailbox, got: ${JSON.stringify(session)}`);
    if (bot.harness === 'claude') assert.equal(session.address, `${bot.name}.daily`);

    tabs[bot.name] = entry;
  }

  return { bots, homeOf, tabs };
}

test('a Claude bot and a Codex bot exchange a message and a reply', async (t) => {
  // Every part of the road is real here: the Run mailboxes, the queued message,
  // the line typed into a tab — the only thing that reaches a harness — the
  // harness reading its own mail, and the reply coming back with the thread on
  // it. The words are the proof: each bot prints what it read, and neither
  // could print the other's word without having read it.
  const { bots, tabs } = await aFleet(t, 'mail');
  const thread = 'obk-system-thread-1';
  const question = 'PELICAN-4417';
  const answer = 'MARMOSET-9930';

  const replyLine = [
    'obk message send', `--bots ${bots}`,
    '--to mail-claude/daily', '--from mail-codex/daily',
    '--subject \'re: the system test\'', `--text '${answer}'`, `--thread ${thread}`,
  ].join(' ');

  // 1. The Claude bot writes to the Codex bot, in its own words but with the
  //    kit's command, and the message tells the Codex bot how to reply.
  await answers(
    tabs['mail-claude'].terminal,
    [
      'Run exactly this command and then print the word SENT and nothing else:',
      `obk message send --bots ${bots} --to mail-codex/daily --from mail-claude/daily`,
      `--subject 'the system test' --thread ${thread}`,
      `--text '${question}. Reply by running this command word for word: ${replyLine}'`,
    ].join(' '),
    'SENT',
    ROUND_TRIP_MS,
  );

  // 2. The Codex bot was nudged, read its own mail and printed what was in it.
  //    Nothing asked it anything: the line the kit typed is the whole wake-up.
  await showsUp(tabs['mail-codex'].terminal, question, ROUND_TRIP_MS);
  const codexScreen = screenOf(tabs['mail-codex'].terminal);
  assert.ok(codexScreen.includes('mail-claude'), `it should know who wrote to it: ${codexScreen.slice(0, 2000)}`);
  assert.ok(codexScreen.includes(thread), `and which thread it is: ${codexScreen.slice(0, 2000)}`);

  // 3. The reply came back the other way, and the Claude bot read it.
  await showsUp(tabs['mail-claude'].terminal, answer, ROUND_TRIP_MS);
  const claudeScreen = screenOf(tabs['mail-claude'].terminal);
  assert.ok(claudeScreen.includes('mail-codex'), `the reply says who sent it: ${claudeScreen.slice(0, 2000)}`);
  assert.ok(claudeScreen.includes(thread), `and carries the thread it belongs to: ${claudeScreen.slice(0, 2000)}`);
});

test('a busy receiver finishes what it was doing before it reads its mail', async (t) => {
  // PRD 6.9: queued, not interrupting. The nudge is a typed line, and both
  // harnesses take one as the next turn rather than cutting into the turn they
  // are having — which is the whole reason the kit types a line instead of
  // interrupting the tab. What proves it is the order on the receiver's own
  // screen: the work it was given finishes first, and the mail is read after.
  const { bots, tabs } = await aFleet(t, 'busy');
  const working = 'HERON-7781';
  const mail = 'OTTER-2245';
  const receiver = tabs['mail-codex'].terminal;

  // Something that takes the receiver a while, and says when it is done.
  await askIn(
    receiver,
    'Count from 1 to 40, printing one number per line, on your own, without running any command. '
    + `When you have printed 40, print ${working} on a line of its own. Do not stop for anything else until then.`,
  );

  // Mail arrives in the middle of it. The kit types the nudge in; nobody
  // interrupts anybody.
  const sent = obk([
    'message', 'send', '--bots', bots, '--to', 'mail-codex/daily', '--from', 'mail-claude/daily',
    '--subject', 'while you are busy', '--text', `${mail} — nothing to do, just read this.`,
  ]);
  assert.equal(sent.status, 0, `the send should have gone through: ${sent.stdout}${sent.stderr}`);

  await showsUp(receiver, mail, ROUND_TRIP_MS);

  const screen = screenOf(receiver);
  assert.ok(screen.includes(working), `the work it was doing should have finished: ${screen.slice(0, 2000)}`);
  assert.ok(
    screen.indexOf(working) < screen.indexOf(mail),
    `the mail should have been read after the work, not in the middle of it: ${screen.slice(0, 3000)}`,
  );
});

test('a long, oddly formatted message arrives unchanged', async (t) => {
  // Above 4 KiB the body is written to a file beside the bots folder and the
  // message names it. So this reads a real message back out of a real mailbox
  // and compares it, character for character, with what was sent — which is
  // also the one check that says whether the fields the kit reads out of
  // `orchestration check` are the fields Orca really answers with.
  //
  // Nothing here goes through an agent: what is being checked is the road, and
  // a model retyping 5 KB of punctuation would be checking the model.
  const { bots, homeOf } = await aFleet(t, 'long');
  const odd = [
    'Line one, with "double quotes", \'single ones\' and a `backtick`.',
    'A line with a tab\there and trailing spaces   ',
    '- a bullet, which would be read as an option on its own',
    '$(whoami) and ${HOME} and $HOME, none of which may be run by anybody',
    'unicode: café — naïve — 日本語 — 🐙',
    'a windows line ending follows\r',
    '',
    'and a blank line above this one.',
    'x'.repeat(5000),
  ].join('\n');

  const sent = obkJson([
    'message', 'send', '--bots', bots, '--to', 'mail-codex/daily', '--from', 'mail-claude/daily',
    '--subject', 'the long one', '--text', odd,
  ]);
  assert.equal(sent.sent, true, `the message should have gone: ${JSON.stringify(sent)}`);

  // Over the limit, so it travels as a file beside the bots folder, and the
  // message says where.
  assert.ok(typeof sent.file === 'string', `a long body should have been written to a file: ${JSON.stringify(sent)}`);
  assert.ok(sent.file.startsWith(`${bots}.`), `and beside the bots folder, not inside it: ${sent.file}`);
  assert.equal(await readFile(sent.file, 'utf8'), odd, 'the file holds what was sent, character for character');

  // And it reads back out of Orca's own store the same way. This is the
  // receiver's own read: it binds to its own Run first, as any session does.
  const read = obkJson(['message', 'check', '--bots', bots, '--bot', 'mail-codex', '--session', 'daily']);
  assert.equal(read.messages.length, 1, `one message should have been waiting: ${JSON.stringify(read)}`);
  const [message] = read.messages;
  assert.equal(message.subject, 'the long one');
  assert.equal(message.from, 'mail-claude/daily', 'the sender is a session of the fleet, so a reply has somewhere to go');
  assert.ok(message.body.includes(sent.file), `the message names the file: ${message.body}`);

  // Read once and acknowledged: Orca replays a message until it is acked, so a
  // second check must not hand the same one over again.
  const again = obkJson(['message', 'check', '--bots', bots, '--bot', 'mail-codex', '--session', 'daily']);
  assert.deepEqual(again.messages, [], `the mail was read already: ${JSON.stringify(again)}`);

  // Nothing of the kit's was left in the bot's own folder: the file lives
  // beside the bots folder, the way a long start prompt does (PRD 6.3).
  const home = homeOf('mail-codex');
  assert.ok(!sent.file.startsWith(home), `the body file must not be in the bot home: ${sent.file}`);
});
