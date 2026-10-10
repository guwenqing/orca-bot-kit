// Approval and permission settings moved out of the ordinary commands (#527).
//
// The kit's ordinary commands are in every bot's default set, so none of them
// may set an approval or a permission: that is a bot granting itself rights.
// What sets one is `obk permission approval` (permission-approval.test.js).
//
//   - `session add --approval <level>` and `session change --approval <level>`
//     (any level, an empty one included) are refused, naming `obk permission
//     approval`, and nothing is written. `session add` without `--approval`
//     still writes `approval: auto`.
//   - An `--extra-arg` that sets approval or permissions is refused by
//     `session add`, `session change`, `temp make` and `groom --run-on codex`,
//     naming `obk permission approval`, and nothing is written. It is judged
//     by the session's harness:
//       Claude: --permission-mode, --dangerously-skip-permissions,
//               --allow-dangerously-skip-permissions, --allowedTools, --allowed-tools;
//       Codex:  -a, --ask-for-approval, --approve-for-me,
//               --dangerously-bypass-approvals-and-sandbox, -s, --sandbox.
//     `--dangerously-bypass-hook-trust` is not among them: it skips the review
//     of the kit's own hooks and widens no command a session runs (the
//     coordinator's ruling on #527, 2026-10-10), so it goes through.
//     An arg is refused when it is one of these, or one of these followed by
//     `=` and a value; for -a and -s, also with the value glued on (-anever).
//     Other extra args go through as today.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertRefused,
  createSandbox,
  orcaCallsOf,
  recordSession,
  sentInto,
  sessionIn,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';
import { liveTab, made, make, TASK, world } from './helpers/temp-roles.js';

const POINTER = 'permission approval';

/** The extra args each harness refuses, in every form the requirement names. */
const REFUSED = {
  claude: [
    '--permission-mode', '--permission-mode=auto', '--permission-mode=bypassPermissions',
    '--dangerously-skip-permissions', '--dangerously-skip-permissions=true',
    '--allow-dangerously-skip-permissions', '--allow-dangerously-skip-permissions=1',
    '--allowedTools', '--allowedTools=Bash', '--allowed-tools', '--allowed-tools=Bash(git:*)',
  ],
  codex: [
    '-a', '-a=never', '-anever', '-aon-request',
    '--ask-for-approval', '--ask-for-approval=never',
    '--approve-for-me', '--approve-for-me=1',
    '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-approvals-and-sandbox=1',
    '-s', '-s=danger-full-access', '-sdanger-full-access',
    '--sandbox', '--sandbox=workspace-write',
  ],
};

/** Extra args each harness lets through as today: some are the other harness's refused ones. */
const ALLOWED = {
  claude: ['--verbose', '--sandbox', '-a', '--approve-for-me', '--dangerously-bypass-hook-trust'],
  codex: ['--search', '--dangerously-skip-permissions', '--permission-mode', '--allowedTools=Bash'],
};

/** A bots folder `init` made, with a Claude bot and a Codex bot, each with a daily session. */
async function fleet(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  for (const harness of ['claude', 'codex']) {
    await ok(['bot', 'create', '--bots', 'bots', '--name', `${harness}-bot`, '--harness', harness]);
    await ok(['session', 'add', '--bots', 'bots', '--bot', `${harness}-bot`, '--name', 'daily']);
  }
  return box.path('bots');
}

const sessionAdd = (box, bot, name, ...rest) => box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...rest]);
const sessionChange = (box, bot, ...rest) => box.run(['session', 'change', '--bots', 'bots', '--bot', bot, '--session', 'daily', ...rest]);

/** A refusal that names the road, and leaves the bots folder as it was. */
async function assertRefusedUntouched(result, bots, before) {
  assertRefused(result, POINTER);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
}

/** One session's entry in a bot's bot.yaml. */
async function entryOf(bots, bot, name) {
  const doc = parse(await readFile(botYamlOf(bots, bot), 'utf8'));
  return doc.sessions.find((one) => one.name === name);
}

// ----------------------------------------------------------------- session add and change --approval

/** Each spelling of an approval flag the two commands refuse. */
const APPROVAL_FLAGS = [
  ['--approval', 'auto'],
  ['--approval', 'ask'],
  ['--approval', 'dangerously-skip'],
  ['--approval=ask'],
  ['--approval='],
];

test('AM1 session add with --approval, any level, glued or empty, is refused, names obk permission approval, and writes nothing', async (t) => {
  // One fleet for every spelling: each refusal must leave it as it was, so the next one starts from the same place.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await snapshot(bots, skipGit);

  for (const args of APPROVAL_FLAGS) {
    await t.test(args.join(' '), async () => {
      await assertRefusedUntouched(await sessionAdd(box, 'claude-bot', 'review', ...args), bots, before);
    });
  }
  assert.equal(await entryOf(bots, 'claude-bot', 'review'), undefined, 'no session was added');
});

test('AM2 session change with --approval, any level, glued or empty, is refused, names obk permission approval, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await snapshot(bots, skipGit);

  for (const args of APPROVAL_FLAGS) {
    await t.test(args.join(' '), async () => {
      await assertRefusedUntouched(await sessionChange(box, 'claude-bot', ...args), bots, before);
    });
  }
});

test('AM2 session change with --approval beside a good setting is refused whole: the good setting is not written either', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await snapshot(bots, skipGit);

  await assertRefusedUntouched(await sessionChange(box, 'claude-bot', '--model', 'opus', '--approval', 'ask'), bots, before);
  assert.equal((await entryOf(bots, 'claude-bot', 'daily')).model, undefined);
});

test('AM1 session add with no --approval still writes approval: auto, and a session change with none leaves it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const added = await sessionAdd(box, 'claude-bot', 'review', '--model', 'sonnet');
  assert.equal(added.code, 0, added.stderr);
  assert.deepEqual(await entryOf(bots, 'claude-bot', 'review'), { name: 'review', approval: 'auto', model: 'sonnet' });

  const changed = await box.run(['session', 'change', '--bots', 'bots', '--bot', 'claude-bot', '--session', 'review', '--model', 'opus']);
  assert.equal(changed.code, 0, changed.stderr);
  assert.equal((await entryOf(bots, 'claude-bot', 'review')).approval, 'auto');
});

// ----------------------------------------------------------------- extra args, session add and change

for (const harness of ['claude', 'codex']) {
  test(`AM3 session add of a ${harness} session refuses each extra arg that sets approval or permissions, naming obk permission approval, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const before = await snapshot(bots, skipGit);

    for (const arg of REFUSED[harness]) {
      await t.test(`--extra-arg=${arg}`, async () => {
        await assertRefusedUntouched(await sessionAdd(box, `${harness}-bot`, 'review', `--extra-arg=${arg}`), bots, before);
      });
    }
  });

  test(`AM3 session add of a ${harness} session refuses a refused arg among good ones, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const before = await snapshot(bots, skipGit);

    const result = await sessionAdd(box, `${harness}-bot`, 'review', `--extra-arg=${ALLOWED[harness][0]}`, `--extra-arg=${REFUSED[harness][1]}`);

    await assertRefusedUntouched(result, bots, before);
  });

  test(`AM4 session change of a ${harness} session refuses each extra arg that sets approval or permissions, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const before = await snapshot(bots, skipGit);

    for (const arg of REFUSED[harness]) {
      await t.test(`--extra-arg=${arg}`, async () => {
        await assertRefusedUntouched(await sessionChange(box, `${harness}-bot`, `--extra-arg=${arg}`), bots, before);
      });
    }
  });

  test(`AM5 the extra args a ${harness} session does not judge as approval go through session add as today`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);

    const result = await sessionAdd(box, `${harness}-bot`, 'review', ...ALLOWED[harness].map((arg) => `--extra-arg=${arg}`));

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual((await entryOf(bots, `${harness}-bot`, 'review')).extra_args, ALLOWED[harness]);
  });
}

test('AM3 a Codex session of a Claude bot is judged as Codex: session add --harness codex refuses -anever', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await snapshot(bots, skipGit);

  await assertRefusedUntouched(await sessionAdd(box, 'claude-bot', 'review', '--harness', 'codex', '--extra-arg=-anever'), bots, before);
});

test('AM5 --dangerously-bypass-hook-trust is no approval flag: session add of a Codex session takes it', async (t) => {
  // It skips the review of the kit's own hooks, and the system tests' Codex sessions pass it (helpers/codex-trust.js).
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const result = await sessionAdd(box, 'codex-bot', 'review', '--extra-arg=--dangerously-bypass-hook-trust');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual((await entryOf(bots, 'codex-bot', 'review')).extra_args, ['--dangerously-bypass-hook-trust']);
});

test('AM4 a near miss is no refused arg: session add of a Codex session takes --sandboxed and -c', async (t) => {
  // `--sandboxed` is not `--sandbox` nor `--sandbox=<value>`; `-c` is not `-a` or `-s` with a value glued on.
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const result = await sessionAdd(box, 'codex-bot', 'review', '--extra-arg=--sandboxed', '--extra-arg=-c', '--extra-arg=tui.show_tooltips=false');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual((await entryOf(bots, 'codex-bot', 'review')).extra_args, ['--sandboxed', '-c', 'tui.show_tooltips=false']);
});

// ----------------------------------------------------------------- extra args, temp make

/** temp-bot (Claude) with one long-lived session, lead, brought up. */
async function tempFleet(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'temp-bot', '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'temp-bot', '--name', 'lead', '--prompt', 'You lead the work on the API.']);
  await ok(['up', '--bots', 'bots', '--bot', 'temp-bot']);
  const bots = box.path('bots');
  return { bots, lead: await liveTab(box, bots, 'lead') };
}

const TEMP_REFUSED = [
  ['a Claude temp, --dangerously-skip-permissions', ['--extra-arg=--dangerously-skip-permissions']],
  ['a Claude temp, --permission-mode=bypassPermissions', ['--extra-arg=--permission-mode=bypassPermissions']],
  ['a Claude temp, --allowedTools', ['--extra-arg=--allowedTools', '--extra-arg=Bash']],
  ['a Codex temp, --sandbox=danger-full-access', ['--harness', 'codex', '--extra-arg=--sandbox=danger-full-access']],
  ['a Codex temp, -anever', ['--harness', 'codex', '--extra-arg=-anever']],
];

test('AM6 temp make refuses an extra arg that sets approval or permissions, judged by the temp\'s harness, names obk permission approval, and makes nothing', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await tempFleet(box);
  const before = await world(box, bots);
  const from = (await box.orca.calls()).length;

  for (const [label, args] of TEMP_REFUSED) {
    await t.test(label, async () => {
      const result = await make(box, lead, ['--name', 'scout', '--prompt', TASK, ...args]);

      assertRefused(result, POINTER);
      assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
      assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal create'), [], 'no tab was opened');
    });
  }
});

test('AM6 temp make takes extra args that set no approval, as today', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await tempFleet(box);

  await made(box, lead, ['--name', 'scout', '--prompt', TASK, '--harness', 'codex', '--extra-arg=--search']);

  assert.deepEqual((await entryOf(bots, 'temp-bot', 'scout')).extra_args, ['--search']);
});

// ----------------------------------------------------------------- extra args, groom --run-on codex

/** Bot Father with its grooming session, brought up, with a conversation its hook reported. */
async function groomFleet(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'bot-father', '--name', 'grooming', '--model', 'opus']);
  assert.equal(added.code, 0, added.stderr);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  const bots = box.path('bots');
  const tab = (await sessionIn(bots, 'bot-father', 'grooming')).tab;
  const told = await recordSession(box, { bots, bot: 'bot-father', tab, session: '0199b2c0-0001-4444-8888-cccccccccccc', source: 'startup' });
  assert.equal(told.code, 0, told.stderr);
  return bots;
}

/** Everything typed into every tab so far, by tab id. */
const sends = async (box) => Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.tabId, sentInto(terminal).length]));

test('AM7 groom --on --run-on codex refuses an extra arg that sets approval or permissions, names obk permission approval, and types nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await groomFleet(box);
  const before = await snapshot(bots, skipGit);
  const typed = await sends(box);

  for (const arg of ['--dangerously-bypass-approvals-and-sandbox', '-anever', '--sandbox=danger-full-access', '--ask-for-approval=never']) {
    await t.test(`--extra-arg=${arg}`, async () => {
      const result = await box.run(['groom', '--bots', 'bots', '--on', '--at', '04:00', '--run-on', 'codex', '--model', 'gpt-6-sol', `--extra-arg=${arg}`]);

      assertRefused(result, POINTER);
      assert.deepEqual(await sends(box), typed, 'nothing typed into any tab');
      assert.deepEqual(await snapshot(bots, skipGit), before, 'nothing written');
    });
  }
});

test('AM7 groom --on --run-on codex takes extra args that set no approval, as today', async (t) => {
  const box = await createSandbox(t);
  await groomFleet(box);
  const typed = await sends(box);

  const result = await box.run(['groom', '--bots', 'bots', '--on', '--at', '04:00', '--run-on', 'codex', '--extra-arg=-c', '--extra-arg=tui.show_tooltips=false', '--json']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.notDeepEqual(await sends(box), typed, 'the --on line was typed');
});
