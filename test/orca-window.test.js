// Orca's window re-reads its project list only when Orca's runtime sends one
// event (#224). `repo add` + `project setup-update` and `project setup-delete`
// do not send it, so after the kit makes, renames or removes an Orca project
// the window can go on showing the old state until the user reloads it.
//
// So after such a change the kit makes one call through Orca's own runtime
// client, the one Orca's `bin/orca` loads out of the installed app, that does
// send it: `project.update` with no changes. And it always prints one hedged
// line saying how to reload, whatever became of that call. Anything that goes
// wrong with the call is swallowed: the command still succeeds, as fast as
// before, and says the same thing.
//
// What the call is made on:
//
//   - a project this run made, or turned from another kind into a folder
//     project: that project;
//   - a bot's project `retire` removed: Bot Father's project of the same bots
//     folder, which is never retired, and no call at all when Orca has none.
//
// The fake app (helpers/cli.js, `orcaApp`) is laid out the way the installed
// one is, and its runtime client writes down every call it gets. The ordinary
// sandbox has no app at all, only a CLI, which the kit has to take as a client
// it cannot reach.
//
// Whether the real window re-reads is the owner's to check by hand.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bookIn,
  botHomeOf,
  CLIENT_HANG_MS,
  createSandbox,
  orcaApp,
  orcaCallsOf,
  recordSession,
  sessionIn,
} from './helpers/cli.js';

/** The one line the kit prints after a project was made, renamed or removed. */
const RELOAD = 'If Orca\'s sidebar does not show it, reload the window with Cmd+Shift+R.';

/** How many lines of a run's output are the reload line. */
const reloadLines = (result) => `${result.stdout}\n${result.stderr}`
  .split('\n')
  .filter((line) => line.trim() === RELOAD)
  .length;

/** The call the kit makes on a project: `project.update`, changing nothing. */
const touch = (projectId) => ({ method: 'project.update', params: { projectId, updates: {} } });

/** The answer of a run asked for JSON: exit 0, and nothing but JSON on the way out. */
function answerOf(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** Orca's record of the folder a bot lives in, as the fake Orca holds it now. */
async function setupOf(box, bot) {
  const home = botHomeOf(box.path('bots'), bot);
  const found = (await box.orca.setups()).filter((setup) => setup.path === home);
  assert.equal(found.length, 1, `Orca should hold one project for ${bot}, got: ${JSON.stringify(await box.orca.setups())}`);
  return found[0];
}

/** Take a bot's project and its tabs out of Orca, as a cleared Orca profile or a user's own delete does. */
async function forgetProjectOf(box, bot) {
  const home = botHomeOf(box.path('bots'), bot);
  await box.orca.set({
    setups: (await box.orca.setups()).filter((setup) => setup.path !== home),
    terminals: (await box.orca.terminals()).filter((terminal) => terminal.worktreePath !== home),
  });
}

async function ok(box, args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}`);
  return result;
}

const init = (box) => ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);

/** A bot with one session, `daily`, not yet up. */
async function newBot(box, bot = 'api-bot') {
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', 'claude']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
}

/** A bot up in Orca, its daily session running a conversation the book knows. */
async function runningBot(box, bot = 'api-bot') {
  await newBot(box, bot);
  await ok(box, ['up', '--bots', 'bots', '--bot', bot]);
  const bots = box.path('bots');
  await recordSession(box, { bots, bot, tab: (await sessionIn(bots, bot, 'daily')).tab, session: 'sess-daily' });
}

/**
 * The four commands that bring a bot up, each set up so the run makes the bot's
 * Orca project: the fake Orca has no setup for its folder. `act` runs the
 * command, with `--json` when asked.
 */
const MAKERS = {
  init: {
    bot: 'bot-father',
    async arrange() {},
    act: (box, json) => box.run(['init', '--bots', 'bots', '--harness', 'claude', ...json]),
  },
  up: {
    bot: 'api-bot',
    async arrange(box) {
      await init(box);
      await newBot(box);
    },
    // The whole fleet: Bot Father's project is there already and is left alone.
    act: (box, json) => box.run(['up', '--bots', 'bots', ...json]),
  },
  restart: {
    bot: 'api-bot',
    async arrange(box) {
      await init(box);
      await runningBot(box);
      await forgetProjectOf(box, 'api-bot');
    },
    act: (box, json) => box.run(['restart', '--bots', 'bots', '--bot', 'api-bot', ...json]),
  },
  unpause: {
    bot: 'api-bot',
    async arrange(box) {
      await init(box);
      await runningBot(box);
      await ok(box, ['pause', '--bots', 'bots', '--bot', 'api-bot']);
      await forgetProjectOf(box, 'api-bot');
    },
    act: (box, json) => box.run(['unpause', '--bots', 'bots', '--bot', 'api-bot', ...json]),
  },
};

// ------------------------------------------------------- a project made

for (const [command, maker] of Object.entries(MAKERS)) {
  test(`W1 W5 ${command} that makes a project calls project.update once on it, and prints the reload line once`, async (t) => {
    const box = await createSandbox(t);
    const app = await orcaApp(box);
    await maker.arrange(box);
    const from = (await app.calls()).length;
    const cliFrom = (await box.orca.calls()).length;

    const result = await maker.act(box, []);

    assert.equal(result.code, 0, result.stderr);
    // The run did make the project, the way it always has: the premise of the test.
    const made = (await box.orca.calls()).slice(cliFrom);
    assert.equal(orcaCallsOf(made, 'repo add').length, 1, `${command} should have made ${maker.bot}'s project`);
    assert.equal(orcaCallsOf(made, 'project setup-update').length, 1);

    const setup = await setupOf(box, maker.bot);
    assert.deepEqual((await app.calls()).slice(from), [touch(setup.projectId)], 'one call, on the project just made, changing nothing');
    assert.equal(
      (await bookIn(box.path('bots'), maker.bot)).orca.project,
      setup.projectId,
      'the id is the one the book records as the bot\'s Orca project',
    );
    assert.equal(reloadLines(result), 1, `the reload line, once, got:\n${result.stdout}${result.stderr}`);
  });

  test(`W6 ${command} --json lists the project it made`, async (t) => {
    const box = await createSandbox(t);
    await orcaApp(box);
    await maker.arrange(box);

    const answer = answerOf(await maker.act(box, ['--json']));

    const setup = await setupOf(box, maker.bot);
    assert.deepEqual(answer.projects, [{ bot: maker.bot, project: setup.projectId, change: 'made' }]);
  });
}

// ---------------------------------------------------- a project renamed

/**
 * api-bot's folder already registered in Orca, but as git kind under the
 * folder's own name: what `repo add` leaves, or a user adding it by hand.
 */
async function registeredAsGit(box) {
  await init(box);
  await newBot(box);
  const home = botHomeOf(box.path('bots'), 'api-bot');
  const theirs = {
    id: 'repo_77',
    projectId: 'proj_77',
    hostId: 'host_local',
    repoId: 'repo_77',
    path: home,
    displayName: 'api-bot',
    kind: 'git',
    setupState: 'ready',
    setupMethod: 'repo-add',
  };
  await box.orca.set({ setups: [...await box.orca.setups(), theirs] });
  return theirs;
}

test('W2 W6 up that turns a registration into a folder project calls project.update on it, and reports it renamed', async (t) => {
  const box = await createSandbox(t);
  const app = await orcaApp(box);
  const theirs = await registeredAsGit(box);
  const from = (await app.calls()).length;
  const cliFrom = (await box.orca.calls()).length;

  const answer = answerOf(await box.run(['up', '--bots', 'bots', '--json']));

  const cli = (await box.orca.calls()).slice(cliFrom);
  assert.equal(orcaCallsOf(cli, 'repo add').length, 0, 'the registration was there, so nothing was made');
  assert.equal(orcaCallsOf(cli, 'project setup-update').length, 1, 'it was turned into a folder project');
  assert.equal((await setupOf(box, 'api-bot')).kind, 'folder');

  assert.deepEqual((await app.calls()).slice(from), [touch(theirs.projectId)], 'one call, on that project');
  assert.deepEqual(answer.projects, [{ bot: 'api-bot', project: theirs.projectId, change: 'renamed' }]);
});

test('W2 W5 a renamed project gets the reload line once', async (t) => {
  const box = await createSandbox(t);
  await orcaApp(box);
  await registeredAsGit(box);

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(reloadLines(result), 1, `got:\n${result.stdout}${result.stderr}`);
});

// ------------------------------------------------------ nothing changed

test('W3 a run that changes no project makes no call, prints no line, and answers projects: []', async (t) => {
  const box = await createSandbox(t);
  const app = await orcaApp(box);
  // The first run makes Bot Father's project: that one calls and says so.
  const first = await init(box);
  assert.equal((await app.calls()).length, 1, 'the run that made the project called');
  assert.equal(reloadLines(first), 1, `and said so, got:\n${first.stdout}`);

  // Every run after it finds a folder project already there.
  const plain = await ok(box, ['up', '--bots', 'bots']);
  const answer = answerOf(await box.run(['up', '--bots', 'bots', '--json']));
  const again = await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal((await app.calls()).length, 1, 'no project changed, so no more calls');
  assert.equal(reloadLines(plain), 0, `up changed no project, got:\n${plain.stdout}`);
  assert.equal(reloadLines(again), 0, `a second init changed no project, got:\n${again.stdout}`);
  assert.deepEqual(answer.projects, []);
});

test('W8 several bots made in one up: one call per made project, one line', async (t) => {
  const box = await createSandbox(t);
  const app = await orcaApp(box);
  await init(box);
  await newBot(box, 'api-bot');
  await newBot(box, 'web-bot');
  const from = (await app.calls()).length;

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const expected = [(await setupOf(box, 'api-bot')).projectId, (await setupOf(box, 'web-bot')).projectId];
  assert.notEqual(expected[0], expected[1]);
  const calls = (await app.calls()).slice(from);
  assert.deepEqual(
    calls.map((call) => call.params?.projectId).sort(),
    [...expected].sort(),
    'one call on each project made, and none on Bot Father\'s, which was there already',
  );
  for (const call of calls) assert.deepEqual(call, touch(call.params.projectId));
  assert.equal(reloadLines(result), 1, `one line for the run, got:\n${result.stdout}`);
});

test('W8 W6 several bots made in one up are each listed in projects', async (t) => {
  const box = await createSandbox(t);
  await orcaApp(box);
  await init(box);
  await newBot(box, 'api-bot');
  await newBot(box, 'web-bot');

  const answer = answerOf(await box.run(['up', '--bots', 'bots', '--json']));

  assert.ok(Array.isArray(answer.projects), `got: ${JSON.stringify(answer)}`);
  assert.deepEqual(
    [...answer.projects].sort((a, b) => (a.bot < b.bot ? -1 : 1)),
    [
      { bot: 'api-bot', project: (await setupOf(box, 'api-bot')).projectId, change: 'made' },
      { bot: 'web-bot', project: (await setupOf(box, 'web-bot')).projectId, change: 'made' },
    ],
  );
});

// ----------------------------------------------------- a project removed

test('W4 retire of a bot calls project.update once on Bot Father\'s project, and its answer is as it was', async (t) => {
  const box = await createSandbox(t);
  const app = await orcaApp(box);
  await init(box);
  await runningBot(box);
  const botFather = await setupOf(box, 'bot-father');
  const apiBot = await setupOf(box, 'api-bot');
  const from = (await app.calls()).length;

  const answer = answerOf(await box.run(['retire', '--bots', 'bots', '--bot', 'api-bot', '--json']));

  assert.equal((await box.orca.setups()).some((setup) => setup.id === apiBot.id), false, 'the project was removed');
  assert.deepEqual((await app.calls()).slice(from), [touch(botFather.projectId)], 'one call, on Bot Father\'s project');
  assert.deepEqual(Object.keys(answer).sort(), ['bot', 'closed', 'moved', 'project'], 'no new key in retire\'s answer');
  assert.equal(answer.project, apiBot.id, 'it still names the project it removed, as it did before');
});

test('W4 W5 retire of a bot that had a project prints the reload line once', async (t) => {
  const box = await createSandbox(t);
  await orcaApp(box);
  await init(box);
  await runningBot(box);

  const result = await box.run(['retire', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(reloadLines(result), 1, `got:\n${result.stdout}${result.stderr}`);
});

test('W4 W5 with no project for Bot Father\'s folder, retire makes no call and still prints the line', async (t) => {
  const box = await createSandbox(t);
  const app = await orcaApp(box);
  await init(box);
  await runningBot(box);
  const home = botHomeOf(box.path('bots'), 'bot-father');
  await box.orca.set({ setups: (await box.orca.setups()).filter((setup) => setup.path !== home) });
  const from = (await app.calls()).length;
  const cliFrom = (await box.orca.calls()).length;

  const result = await box.run(['retire', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(orcaCallsOf((await box.orca.calls()).slice(cliFrom), 'project setup-delete').length, 1, 'api-bot\'s project was removed');
  assert.deepEqual((await app.calls()).slice(from), [], 'there is no project of Bot Father\'s to call on');
  assert.equal(reloadLines(result), 1, `a project was removed all the same, got:\n${result.stdout}${result.stderr}`);
});

test('W4 retire of a bot that had no Orca project makes no call and prints no line', async (t) => {
  const box = await createSandbox(t);
  const app = await orcaApp(box);
  await init(box);
  await newBot(box, 'idle-bot');
  await runningBot(box, 'api-bot');
  const from = (await app.calls()).length;

  const never = await box.run(['retire', '--bots', 'bots', '--bot', 'idle-bot']);

  assert.equal(never.code, 0, never.stderr);
  assert.deepEqual((await app.calls()).slice(from), [], 'nothing was removed, so nothing to call about');
  assert.equal(reloadLines(never), 0, `got:\n${never.stdout}`);

  // Beside it, a bot that did have one: the call and the line.
  const had = await box.run(['retire', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(had.code, 0, had.stderr);
  assert.equal((await app.calls()).slice(from).length, 1);
  assert.equal(reloadLines(had), 1, `got:\n${had.stdout}`);
});

test('W4 retire of a session removes no project: no call, no line', async (t) => {
  const box = await createSandbox(t);
  const app = await orcaApp(box);
  await init(box);
  await runningBot(box);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'review']);
  const from = (await app.calls()).length;

  const session = await box.run(['retire', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);

  assert.equal(session.code, 0, session.stderr);
  assert.deepEqual((await app.calls()).slice(from), []);
  assert.equal(reloadLines(session), 0, `got:\n${session.stdout}`);

  // The bot itself, after it: its project goes, so the call and the line.
  const bot = await box.run(['retire', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(bot.code, 0, bot.stderr);
  assert.equal((await app.calls()).slice(from).length, 1);
  assert.equal(reloadLines(bot), 1, `got:\n${bot.stdout}`);
});

// ------------------------------------------ how the kit reaches the client

test('W1 the client runs as plain Node, without the NODE_OPTIONS or NODE_REPL_EXTERNAL_MODULE of the kit\'s own run', async (t) => {
  const box = await createSandbox(t);
  const app = await orcaApp(box);
  await init(box);
  await newBot(box);
  const loaded = (await app.loads()).length;

  const result = await box.run(['up', '--bots', 'bots'], {
    env: { ...box.env, NODE_OPTIONS: '--no-deprecation', NODE_REPL_EXTERNAL_MODULE: box.path('no-such-repl.js') },
  });

  assert.equal(result.code, 0, result.stderr);
  const loads = (await app.loads()).slice(loaded);
  assert.equal(loads.length, 1, 'the client was loaded once, for the one project made');
  assert.deepEqual(loads[0].env, { ELECTRON_RUN_AS_NODE: '1' });
  assert.deepEqual(await app.calls(), [touch((await setupOf(box, 'bot-father')).projectId), touch((await setupOf(box, 'api-bot')).projectId)]);
});

// ------------------------------------------------------------ fallback

/**
 * The ways Orca's client can be out of reach or refuse, and what the fake
 * records of the attempt: the number of calls, or of loads where the client
 * never gets as far as a call. Null where nothing can be seen of it.
 */
const FALLBACKS = [
  { name: 'there is no Orca app, only a CLI', app: null, calls: 0, loads: null },
  { name: 'the Orca executable is missing', app: { executable: false }, calls: 0, loads: 0 },
  { name: 'the client file is missing', app: { client: 'missing' }, calls: 0, loads: 0 },
  { name: 'the client file has no RuntimeClient export', app: { client: 'no-export' }, calls: 0, loads: 1 },
  { name: 'call rejects with method_not_found', app: { client: 'method-not-found' }, calls: 1, loads: 1 },
  { name: 'call rejects with Project not found', app: { client: 'project-not-found' }, calls: 1, loads: 1 },
  { name: 'call never settles', app: { client: 'never-settles' }, calls: 1, loads: 1 },
];

/** A run's output with everything that differs between two sandboxes taken out. */
const withoutTheSandbox = (box, text) => text.split(box.root).join('<root>');

/** `up` of a new bot in a fresh sandbox whose Orca app is `app` (null: none). */
async function upOfANewBot(t, app, json) {
  const box = await createSandbox(t);
  const fake = app === null ? null : await orcaApp(box, app);
  await init(box);
  await newBot(box);
  const loaded = fake === null ? 0 : (await fake.loads()).length;
  const called = fake === null ? 0 : (await fake.calls()).length;

  const started = Date.now();
  const result = await box.run(['up', '--bots', 'bots', ...json]);
  const took = Date.now() - started;

  return {
    box,
    result,
    took,
    output: { code: result.code, stdout: withoutTheSandbox(box, result.stdout), stderr: withoutTheSandbox(box, result.stderr) },
    calls: fake === null ? null : (await fake.calls()).slice(called),
    loads: fake === null ? null : (await fake.loads()).slice(loaded),
  };
}

for (const fallback of FALLBACKS) {
  test(`W7 W5 when ${fallback.name}, up says exactly what it says when the call works, reload line included`, async (t) => {
    const broken = await upOfANewBot(t, fallback.app, []);

    assert.equal(broken.result.code, 0, broken.result.stderr);
    assert.equal(reloadLines(broken.result), 1, `the reload line, once, got:\n${broken.result.stdout}${broken.result.stderr}`);
    if (broken.calls !== null) assert.equal(broken.calls.length, fallback.calls, 'tried at most once, never again');
    if (fallback.loads !== null) assert.equal(broken.loads.length, fallback.loads, 'loaded at most once');

    const works = await upOfANewBot(t, {}, []);
    assert.equal(works.calls.length, 1, 'the working client was called');
    assert.deepEqual(broken.output, works.output);
  });

  test(`W7 W6 when ${fallback.name}, up --json answers exactly what it answers when the call works`, async (t) => {
    const broken = await upOfANewBot(t, fallback.app, ['--json']);

    const answer = answerOf(broken.result);
    assert.deepEqual(answer.projects, [{ bot: 'api-bot', project: (await setupOf(broken.box, 'api-bot')).projectId, change: 'made' }]);
    if (broken.calls !== null) assert.equal(broken.calls.length, fallback.calls, 'tried at most once, never again');

    const works = await upOfANewBot(t, {}, ['--json']);
    assert.equal(works.calls.length, 1, 'the working client was called');
    assert.deepEqual(broken.output, works.output);
  });
}

test('W7 a client that hangs holds up no more than about 5 seconds, and up still says what it says when the call works', async (t) => {
  const works = await upOfANewBot(t, {}, []);

  const hung = await upOfANewBot(t, { client: 'hangs' }, []);

  assert.equal(hung.result.code, 0, hung.result.stderr);
  assert.deepEqual(hung.calls, [touch((await setupOf(hung.box, 'api-bot')).projectId)], 'the call was made, once');
  assert.equal(reloadLines(hung.result), 1, `got:\n${hung.result.stdout}${hung.result.stderr}`);
  assert.deepEqual(hung.output, works.output);
  assert.ok(
    hung.took - works.took < 8000,
    `a client that hangs for ${CLIENT_HANG_MS} ms held the run ${hung.took} ms against ${works.took} ms for a working one`,
  );
});
