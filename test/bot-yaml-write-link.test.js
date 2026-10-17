// A kit write over bot.yaml never writes through a link at the name of its own
// temporary file (#585, R12, from review).
//
// The kit writes bot.yaml through a new file beside it, `bot.yaml.<pid>.part`,
// renamed over it. A session can make links in its own bot folder (a Codex
// session can, inside its sandbox), and pids on a machine come close to one
// after another, so a link may already be waiting at that name. A command that
// writes bot.yaml then writes nothing into the place the link leads to, outside
// the bot folder: a file there keeps its text, and a link to nothing makes no
// file. And bot.yaml afterwards is a file, not a link. The command may go
// through or refuse; either is taken.
//
// How the name is hit: helpers/pid-gate.js, loaded into the command with
// `node --import`, writes the command's own pid and waits before the kit runs.
// The test makes the link at `bot.yaml.<that pid>.part` and lets it go on. The
// pid is the real one, so nothing about the command is changed, and a kit that
// names its temporary file another way is simply not hit.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import { access, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { botHomeOf, createSandbox, repoRoot } from './helpers/cli.js';

const BOT = 'api-bot';
const PID_GATE_ENTRY = path.join(repoRoot, 'test', 'helpers', 'pid-gate.js');
const OUTSIDE_TEXT = 'a file of the user\'s, outside the bot folder\n';

const isThere = (file) => access(file).then(() => true, () => false);

/** api-bot on Claude, with its daily session. Answers the bot home. */
async function withSession(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  return botHomeOf(box.path('bots'), BOT);
}

// Each command writes bot.yaml when it goes through.
const COMMANDS = [
  ['session add', ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'nightly']],
  ['session change', ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--model', 'opus']],
];

// Where the planted link leads: a file there, or a name with nothing at it.
const TARGETS = [
  ['a file outside', true],
  ['a name outside with nothing at it', false],
];

for (const [command, args] of COMMANDS) {
  for (const [label, present] of TARGETS) {
    test(`R12 ${command} with a link at bot.yaml.<its pid>.part to ${label} writes nothing there, and bot.yaml stays a file`, async (t) => {
      const box = await createSandbox(t);
      const home = await withSession(box);
      const outside = path.join(box.root, 'outside', 'target.txt');
      await mkdir(path.dirname(outside), { recursive: true });
      if (present) await writeFile(outside, OUTSIDE_TEXT);
      const gate = box.path('pid-gate');
      const env = {
        ...box.env,
        NODE_OPTIONS: [box.env.NODE_OPTIONS, `--import=${pathToFileURL(PID_GATE_ENTRY).href}`].filter(Boolean).join(' '),
        OBK_TEST_PID_GATE: gate,
      };

      let ended = false;
      const run = box.run(args, { env }).finally(() => { ended = true; });
      while (!(await isThere(`${gate}.pid`))) {
        assert.equal(ended, false, 'the premise: the command says its pid before it runs');
        await delay(10);
      }
      const pid = (await readFile(`${gate}.pid`, 'utf8')).trim();
      await symlink(outside, path.join(home, `bot.yaml.${pid}.part`));
      await writeFile(`${gate}.go`, '');
      const result = await run;

      const said = `exit ${result.code}:\n${result.stdout}${result.stderr}`;
      if (present) {
        assert.equal(await readFile(outside, 'utf8'), OUTSIDE_TEXT, `the file outside keeps its text, ${said}`);
      } else {
        assert.equal(await isThere(outside), false, `no file is made outside at ${outside}, ${said}`);
      }
      const after = await lstat(path.join(home, 'bot.yaml'));
      assert.equal(after.isSymbolicLink(), false, `bot.yaml is not made a link, ${said}`);
      assert.equal(after.isFile(), true, `bot.yaml is still a file, ${said}`);
    });
  }
}
