// Pi slice 4 (#659, of #547): a Pi session follows its bot's rules and can use
// its bot's skills, as a Claude Code or Codex session of the same bot does.
//
//   R1  A Pi session starts from its bot's rules, the bot's AGENTS.md: its tab
//       opens in the bot folder, and Pi reads the AGENTS.md of the folder it
//       starts in whatever the project trust (tech notes, section 6). Pi has
//       no permission rules and no hooks, so the kit writes neither for it,
//       and `obk rules build` and `obk up` say so for each bot with a Pi
//       session.
//   R2  A Pi session can use the skills its bot's lists name, with Pi's
//       project trust left as it is. `--no-approve` keeps Pi from the folder's
//       own `.agents/skills`, so the kit names that folder on each Pi launch
//       line with `--skill`. A skill added or taken away reaches a running Pi
//       session through `obk skills build`, which types `/reload` into its tab
//       when Pi is idle, and says what to do when it could not: Pi refuses
//       `/reload` while it works, and a line typed onto a draft mixes with it.
//       `obk skills build` and `obk up` say how a Pi session gets its skills.
//
// The boundary: nothing is written into ~/.pi/agent or into any folder every
// Pi session reads; `--no-approve` stays on every Pi launch line.
//
// The launch line is read as the tab got it and run through a real shell
// against a fake `pi` (helpers/pi.js), so what is checked is the argv a real
// `pi` would get. What `skills build` told each session is read from its plain
// report, one line per session: `  <word>  <bot>/<session>  <what happened>`,
// the word `reloaded` when a line was typed and `not told` otherwise. Every
// run is in the sandbox (helpers/cli.js), with the fake Orca; nothing here
// reaches the real Orca, the real `pi` or the real ~/.pi.

import assert from 'node:assert/strict';
import { access, mkdir, readFile, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  botHomeOf,
  createSandbox,
  hookFileOf,
  hooksIn,
  kitHooksIn,
  orcaCallsOf,
  orcaFlag,
  sentInto,
  sessionIn,
  sh,
  snapshot,
  tabsOfBot,
} from './helpers/cli.js';
import { fakePi, piLines, piSessionOnRecord } from './helpers/pi.js';
import { addRules, agentsIn, blockIn, defaultUnits, headingsIn, underIn, unitText, writeUnit } from './helpers/rules.js';
import { addSkills, botYamlOf, setSkills } from './helpers/skills.js';

/** Pi's own command for taking changed skills and context files (tech notes, section 6). */
const PI_RELOAD = '/reload';

/** Claude Code's, which must never reach a Pi tab. */
const CLAUDE_RELOAD = '/reload-skills';

/** `/reload` as a word, and not the start of `/reload-skills`. */
const NAMES_PI_RELOAD = /\/reload(?![-\w])/;

/** The sentence slice 1 left in the report, which this slice takes away. */
const NOT_YET = /does not give a Pi session skills/i;

/** One of the kit's own skills: the change a build makes. */
const KIT_SKILL = 'obk-tdd';

const PROMPT = 'Keep the queue moving.';
const PI_MODEL = 'anthropic/claude-opus-5-5';

/**
 * The bots a fleet here can hold. `pier` is a bot on Pi with one Pi session.
 * `mixer` is a bot on Claude with a Claude session, a Pi session and a Codex
 * session. `web-bot` has no Pi session at all. Their names are chosen to
 * appear in no sentence of the kit's own.
 */
const BOTS = {
  pier: { harness: 'pi', sessions: [['daily', 'pi']] },
  mixer: { harness: 'claude', sessions: [['daily', 'claude'], ['pier', 'pi'], ['reviewer', 'codex']] },
  'web-bot': { harness: 'claude', sessions: [['daily', 'claude']] },
};

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/** Write the bots named in `names` from BOTS (or `specs`, to say otherwise), and their sessions. */
async function botsIn(box, names, specs = BOTS, bots = 'bots') {
  const init = await box.run(['init', '--bots', bots, '--harness', 'claude']);
  assert.equal(init.code, 0, `${init.stdout}${init.stderr}`);
  for (const name of names) {
    const { harness, sessions } = specs[name];
    const made = await box.run(['bot', 'create', '--bots', bots, '--name', name, '--harness', harness, '--charter', `${name} owns its own corner.`]);
    assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
    for (const [session, on] of sessions) {
      const extra = on === 'pi' ? ['--model', PI_MODEL, '--effort', 'high', '--prompt', PROMPT] : [];
      const added = await box.run(['session', 'add', '--bots', bots, '--bot', name, '--name', session, '--harness', on, ...extra]);
      assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
    }
  }
  return box.path(bots);
}

/**
 * A fleet that is up: Bot Father and the bots named, every tab with its launch
 * line and nothing since. Answers the bots folder, the fake `pi`, and what
 * `obk up` printed.
 */
async function fleetIn(box, names = ['pier']) {
  const pi = await fakePi(box);
  const bots = await botsIn(box, names);
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, `obk up: ${up.stdout}${up.stderr}`);
  return { bots, pi, up };
}

/** `obk skills build`, plain, with whatever else the test wants to say. */
const build = (box, ...rest) => box.run(['skills', 'build', '--bots', 'bots', ...rest]);

/** One session's tab as the fake Orca holds it, by the tab the book names. */
async function terminalOf(box, bots, bot, session) {
  const tab = (await sessionIn(bots, bot, session))?.tab;
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(terminal, `the premise: Orca holds ${bot}/${session}'s tab ${tab}`);
  return terminal;
}

/** Change one tab in the fake Orca's world. */
async function setTab(box, tabId, changes) {
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tabId), `the premise: Orca has the tab ${tabId}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tabId ? { ...one, ...changes } : one)) });
}

/** Each `terminal send` into every tab since its launch line, `{ text, enter }`, by tab id. */
async function sentSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = sentInto(terminal).slice(1);
  return after;
}

/** What was typed into one session's tab since its launch line. */
const sentToSession = async (box, bots, bot, session) => sentInto(await terminalOf(box, bots, bot, session)).slice(1);

/**
 * `/reload`, typed once and sent off: every text typed since the launch line
 * reads `/reload` when put together, one Enter went with it, and the Enter came
 * last. Whether the text and its Enter go in one send or two is the kit's own
 * business (tech notes, section 6: Pi ran it from one piece of text and a
 * return after it).
 */
function assertReloadedOnce(sent, what) {
  assert.notEqual(sent.length, 0, `${what}: /reload should have been typed, got nothing`);
  assert.equal(sent.map((one) => one.text).join(''), PI_RELOAD, `${what}: exactly /reload, got: ${JSON.stringify(sent)}`);
  assert.equal(sent.filter((one) => one.enter).length, 1, `${what}: sent off with one Enter, got: ${JSON.stringify(sent)}`);
  assert.equal(sent.at(-1).enter, true, `${what}: the Enter comes after the text, got: ${JSON.stringify(sent)}`);
}

/**
 * The one line of a plain `skills build` report about `<bot>/<session>`, and
 * its first word: `reloaded` or `not told`.
 */
function toldLine(stdout, bot, session) {
  const who = `${bot}/${session}`;
  const lines = stdout.split('\n').filter((line) => line.includes(` ${who} `) || line.endsWith(` ${who}`));
  assert.equal(lines.length, 1, `the report should have one line about ${who}, got:\n${stdout}`);
  const word = /^ {2}(.+?) {2,}/.exec(lines[0])?.[1];
  return { line: lines[0], word };
}

/** A not-told line for a Pi session: what to type afterwards, if it says, is /reload and never /reload-skills. */
function assertNotToldPi(result, bot, session, { saysReload }) {
  const { line, word } = toldLine(result.stdout, bot, session);
  assert.equal(word, 'not told', `${bot}/${session} was not told, got: ${line}`);
  assert.ok(!line.includes(CLAUDE_RELOAD), `a Pi session is never told to type ${CLAUDE_RELOAD}, got: ${line}`);
  if (saysReload) assert.match(line, NAMES_PI_RELOAD, `it says to type /reload in its tab afterwards, got: ${line}`);
  assert.doesNotMatch(result.stdout, NOT_YET, `slice 1's sentence is gone, got:\n${result.stdout}`);
  return line;
}

/**
 * Every line of a plain report that is about `bot`: the lines indented under a
 * line that is the bot's name alone, and every line that names the bot as a
 * word of its own (`bot` or `bot/<session>`).
 */
function linesAbout(stdout, bot) {
  const named = new RegExp(`(?:^|[\\s(])${bot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s/:,.)]|$)`);
  const out = [];
  let under = false;
  for (const line of stdout.split('\n')) {
    if (line === bot) {
      under = true;
      continue;
    }
    if (!line.startsWith(' ')) under = false;
    if (under || named.test(line)) out.push(line);
  }
  return out;
}

/** The line about `bot` that says its Pi sessions load its skills from its `.agents/skills`. */
const piSkillsLine = (stdout, bot) => linesAbout(stdout, bot).find((line) => /\bPi\b/.test(line) && line.includes('.agents/skills'));

/** The line about `bot` that says Pi has no permission rules and no hooks, so the kit writes neither. */
const piRulesLine = (stdout, bot) => linesAbout(stdout, bot).find((line) => /\bPi\b/.test(line) && /permission/i.test(line) && /hook/i.test(line));

/** Lines about `bot` that mention Pi at all. */
const piLinesAbout = (stdout, bot) => linesAbout(stdout, bot).filter((line) => /\bPi\b/.test(line));

/** The argv a shell running `line` hands `pi`: the one launch it makes, and only one. */
async function piArgvOf(box, line, pi) {
  const before = (await pi.launches()).length;
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const launches = (await pi.launches()).slice(before);
  assert.equal(launches.length, 1, `the line should start pi once, and only once: ${line}`);
  return launches[0].args;
}

/** The argv before `--`: the flags, without the prompt. */
const flagsOf = (argv) => (argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv);

/** The value a flag takes in an argv, or undefined. */
const valueOf = (argv, flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);

/** The folder Pi is to load the bot's skills from: the bot's own `.agents/skills`, by its real path. */
const skillFolderOf = async (home) => path.join(await realpath(home), '.agents', 'skills');

/**
 * One `--skill`, naming `folder`, among the flags, and `--no-approve` with it,
 * and nothing that lets Pi trust the folder.
 */
function assertSkillFlag(argv, folder) {
  const flags = flagsOf(argv);
  assert.equal(flags.filter((arg) => arg === '--skill').length, 1, `one --skill on the line, got: ${JSON.stringify(argv)}`);
  assert.equal(valueOf(flags, '--skill'), folder, `--skill names the bot's own .agents/skills by its real path, got: ${JSON.stringify(argv)}`);
  assert.ok(flags.includes('--no-approve'), `--no-approve stays on the line, got: ${JSON.stringify(argv)}`);
  for (const trust of ['--approve', '-a']) {
    assert.equal(flags.includes(trust), false, `a Pi line carries no ${trust}, got: ${JSON.stringify(argv)}`);
  }
}

/** The launch line one session's tab got: the first thing typed into it. */
async function launchLineOf(box, bots, bot, session) {
  const typed = sentInto(await terminalOf(box, bots, bot, session));
  assert.notEqual(typed.length, 0, `the premise: ${bot}/${session}'s tab got its launch line`);
  return typed[0].text;
}

/** The session's tab, closed the way a user closes one: Orca stops listing it. */
async function closeTab(box, tabId) {
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId) });
}

const exists = (file) => access(file).then(() => true, () => false);

/** A rule change every bot in the folder feels, so a rules build has something to write. */
async function changeARule(bots) {
  await writeUnit(bots, 'house', unitText('The house style', 'Say it in one line.'));
  await addRules(path.join(bots, 'defaults.yaml'), 'house');
}

describe('a Pi session follows its bot\'s rules and can use its bot\'s skills (#659)', { concurrency: 4 }, () => {
  // ----------------------------------------------------------------- 1. the launch line

  it('L1 up of a Pi session types a line with one --skill naming the bot\'s .agents/skills, and keeps everything it had', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, pi } = await fleetIn(box, ['pier']);
    const home = botHomeOf(bots, 'pier');

    const argv = await piArgvOf(box, await launchLineOf(box, bots, 'pier', 'daily'), pi);

    assertSkillFlag(argv, await skillFolderOf(home));
    assert.equal(valueOf(argv, '--session-id'), (await sessionIn(bots, 'pier', 'daily'))?.session, `the id the book holds, got: ${JSON.stringify(argv)}`);
    assert.equal(valueOf(argv, '--name'), 'pier.daily', `got: ${JSON.stringify(argv)}`);
    assert.equal(valueOf(argv, '--model'), PI_MODEL, `got: ${JSON.stringify(argv)}`);
    assert.equal(valueOf(argv, '--thinking'), 'high', `got: ${JSON.stringify(argv)}`);
    assert.deepEqual(argv.slice(-2), ['--', PROMPT], `the start prompt comes last, after --, got: ${JSON.stringify(argv)}`);
    // R1: Pi reads the AGENTS.md of the folder it starts in, and its tab opens in the bot folder.
    const tab = (await sessionIn(bots, 'pier', 'daily'))?.tab;
    assert.ok((await tabsOfBot(box, bots, 'pier')).some((one) => one.tabId === tab), 'the Pi tab opens in the bot folder, beside its AGENTS.md');
  });

  for (const harness of ['claude', 'codex']) {
    it(`L1 a Pi session of a bot on ${harness} gets the same --skill, and the bot's ${harness} session gets none`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const pi = await fakePi(box);
      const specs = { duo: { harness, sessions: [['daily', harness], ['pier', 'pi']] } };
      const bots = await botsIn(box, ['duo'], specs);
      const up = await box.run(['up', '--bots', 'bots']);
      assert.equal(up.code, 0, `obk up: ${up.stdout}${up.stderr}`);

      const argv = await piArgvOf(box, await launchLineOf(box, bots, 'duo', 'pier'), pi);
      assertSkillFlag(argv, await skillFolderOf(botHomeOf(bots, 'duo')));
      const other = await launchLineOf(box, bots, 'duo', 'daily');
      assert.ok(!/ --skill\b/.test(other), `a ${harness} launch line carries no --skill, got: ${other}`);
    });
  }

  it('L1 a Pi resume carries the same --skill, with the same session id and no prompt', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, pi } = await fleetIn(box, ['pier']);
    const home = botHomeOf(bots, 'pier');
    const id = (await sessionIn(bots, 'pier', 'daily'))?.session;
    await piSessionOnRecord({ home: box.home, cwd: home, id, lines: [piLines.user(PROMPT, new Date(), 1)] });
    await closeTab(box, (await sessionIn(bots, 'pier', 'daily'))?.tab);
    const piBefore = await snapshot(path.join(box.home, '.pi'));

    const again = await box.run(['up', '--bots', 'bots', '--bot', 'pier']);

    assert.equal(again.code, 0, `${again.stdout}${again.stderr}`);
    const argv = await piArgvOf(box, await launchLineOf(box, bots, 'pier', 'daily'), pi);
    assert.equal(valueOf(argv, '--session-id'), id, `the premise: a resume, got: ${JSON.stringify(argv)}`);
    assert.equal(argv.includes('--'), false, `the premise: a resume carries no prompt, got: ${JSON.stringify(argv)}`);
    assertSkillFlag(argv, await skillFolderOf(home));
    assert.deepEqual(await snapshot(path.join(box.home, '.pi')), piBefore, 'HOME/.pi holds what Pi wrote and nothing of the kit\'s');
    assert.equal(await exists(path.join(home, '.pi')), false, 'and no .pi folder in the bot folder');
  });

  it('L1 a bots folder reached through a link: --skill names the real path, not the link', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    const real = path.join(box.root, 'elsewhere', 'real-bots');
    await mkdir(real, { recursive: true });
    await symlink(real, box.path('linked-bots'));
    const linked = await botsIn(box, ['pier'], BOTS, 'linked-bots');
    const up = await box.run(['up', '--bots', 'linked-bots']);
    assert.equal(up.code, 0, `obk up: ${up.stdout}${up.stderr}`);

    const terminal = (await box.orca.terminals()).find((one) => sentInto(one)[0]?.text.includes(' pi '));
    assert.ok(terminal, `the premise: one tab got a Pi launch line, got: ${JSON.stringify((await box.orca.terminals()).map((one) => sentInto(one)[0]?.text))}`);
    const argv = await piArgvOf(box, sentInto(terminal)[0].text, pi);
    const folder = path.join(real, 'bots', 'pier', '.agents', 'skills');
    assert.equal(folder, await skillFolderOf(botHomeOf(linked, 'pier')), 'the premise: the link leads to the real folder');
    assertSkillFlag(argv, folder);
  });

  it('L1 a bots folder whose path has a space: the --skill word reaches Pi whole', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    const bots = await botsIn(box, ['pier'], BOTS, 'my bots');
    const up = await box.run(['up', '--bots', 'my bots']);
    assert.equal(up.code, 0, `obk up: ${up.stdout}${up.stderr}`);

    const argv = await piArgvOf(box, await launchLineOf(box, bots, 'pier', 'daily'), pi);
    assertSkillFlag(argv, await skillFolderOf(botHomeOf(bots, 'pier')));
  });

  // ----------------------------------------------------------------- 2. telling a running Pi session

  it('T1 an idle Pi session gets /reload typed once into its own tab, and its line says reloaded and names /reload', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier', 'web-bot']);
    await addSkills(botYamlOf(bots, 'pier'), `kit:${KIT_SKILL}`);
    const from = (await box.orca.calls()).length;

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const own = await terminalOf(box, bots, 'pier', 'daily');
    const sent = await sentSinceLaunch(box);
    assertReloadedOnce(sent[own.tabId], 'pier/daily');
    for (const [tab, lines] of Object.entries(sent)) {
      if (tab !== own.tabId) assert.deepEqual(lines, [], `nothing may be typed into ${tab}: it is not a running session of pier`);
    }
    const sends = orcaCallsOf((await box.orca.calls()).slice(from), 'terminal send');
    assert.ok(sends.every((call) => orcaFlag(call, '--terminal') === own.handle), `every send went into pier/daily's own tab, got: ${JSON.stringify(sends.map((call) => call.args))}`);
    assert.deepEqual(sends.filter((call) => call.args.includes('--interrupt')), [], 'an idle Pi is not interrupted');
    const { line, word } = toldLine(result.stdout, 'pier', 'daily');
    assert.equal(word, 'reloaded', `got: ${line}`);
    assert.match(line, NAMES_PI_RELOAD, `the line names /reload, got: ${line}`);
    assert.ok(!line.includes(CLAUDE_RELOAD), `and not Claude's command, got: ${line}`);
    assert.doesNotMatch(result.stdout, NOT_YET, `slice 1's sentence is gone, got:\n${result.stdout}`);
  });

  it('T1 one build tells each session of one bot its own way: Claude /reload-skills, Pi /reload, Codex nothing typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['mixer']);
    await addSkills(botYamlOf(bots, 'mixer'), `kit:${KIT_SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(await sentToSession(box, bots, 'mixer', 'daily'), [{ text: CLAUDE_RELOAD, enter: true }], 'the Claude session gets its own command, as today');
    assertReloadedOnce(await sentToSession(box, bots, 'mixer', 'pier'), 'mixer/pier');
    assert.deepEqual(await sentToSession(box, bots, 'mixer', 'reviewer'), [], 'the Codex session gets nothing typed, as today');
    assert.equal(toldLine(result.stdout, 'mixer', 'daily').word, 'reloaded');
    const pier = toldLine(result.stdout, 'mixer', 'pier');
    assert.equal(pier.word, 'reloaded', `got: ${pier.line}`);
    assert.match(pier.line, NAMES_PI_RELOAD, `got: ${pier.line}`);
    assert.ok(!pier.line.includes(CLAUDE_RELOAD), `got: ${pier.line}`);
    // The boundary: the kit gives Pi its skills on the launch line and by
    // /reload, and writes nothing of Pi's own, after up, skills build and a
    // rules build.
    await changeARule(bots);
    const rules = await box.run(['rules', 'build', '--bots', 'bots']);
    assert.equal(rules.code, 0, `${rules.stdout}${rules.stderr}`);
    assert.equal(await exists(path.join(box.home, '.pi')), false, 'no HOME/.pi at all: nothing of Pi\'s own is written by the kit');
    assert.equal(await exists(path.join(botHomeOf(bots, 'mixer'), '.pi')), false, 'no .pi folder in the bot folder');
  });

  it('T1 a skill taken away reaches the Pi session too: /reload is typed again', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier']);
    await addSkills(botYamlOf(bots, 'pier'), `kit:${KIT_SKILL}`);
    assert.equal((await build(box)).code, 0);
    const before = (await sentToSession(box, bots, 'pier', 'daily')).length;

    await setSkills(botYamlOf(bots, 'pier'));
    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assertReloadedOnce((await sentToSession(box, bots, 'pier', 'daily')).slice(before), 'pier/daily after the skill was taken away');
    assert.equal(toldLine(result.stdout, 'pier', 'daily').word, 'reloaded');
  });

  it('T1 a build that changes nothing types nothing more into the Pi tab', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier']);
    await addSkills(botYamlOf(bots, 'pier'), `kit:${KIT_SKILL}`);
    assert.equal((await build(box)).code, 0);
    const before = await sentSinceLaunch(box);
    assertReloadedOnce(before[(await terminalOf(box, bots, 'pier', 'daily')).tabId], 'the first build told pier/daily');

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(await sentSinceLaunch(box), before, 'nothing changed, so nothing is typed anywhere');
  });

  it('T2 a busy Pi session gets nothing typed: not told, and told to type /reload once its turn ends; the Claude beside it still gets /reload-skills', LIMIT, async (t) => {
    // Pi refuses /reload while it works, and keeps nothing for later (tech
    // notes, section 6). A busy Claude tab queues its command, as today.
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['mixer']);
    await box.orca.set({ waitIdle: 'busy' });
    await addSkills(botYamlOf(bots, 'mixer'), `kit:${KIT_SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `a session not told is not a failure: ${result.stdout}${result.stderr}`);
    assert.deepEqual(await sentToSession(box, bots, 'mixer', 'pier'), [], 'nothing typed into a busy Pi tab');
    const line = assertNotToldPi(result, 'mixer', 'pier', { saysReload: true });
    assert.match(line, /busy|working|at work/i, `it says the Pi session is busy, got: ${line}`);
    assert.deepEqual(await sentToSession(box, bots, 'mixer', 'daily'), [{ text: CLAUDE_RELOAD, enter: true }], 'the busy Claude session queues its command, as today');
    assert.equal(toldLine(result.stdout, 'mixer', 'daily').word, 'reloaded');
  });

  it('T2 a draft in the Pi session\'s input line: nothing typed, not told, and told to type /reload', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier']);
    await setTab(box, (await terminalOf(box, bots, 'pier', 'daily')).tabId, { draft: 'half a thought about the release' });
    await addSkills(botYamlOf(bots, 'pier'), `kit:${KIT_SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(await sentToSession(box, bots, 'pier', 'daily'), [], 'a line typed onto the user\'s draft mixes with it');
    assertNotToldPi(result, 'pier', 'daily', { saysReload: true });
  });

  it('T2 a Pi tab with something on screen to answer: nothing typed, not told, /reload and never /reload-skills', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier']);
    await box.orca.set({ waitIdle: 'blocked' });
    await addSkills(botYamlOf(bots, 'pier'), `kit:${KIT_SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], 'nothing typed into any tab');
    assertNotToldPi(result, 'pier', 'daily', { saysReload: true });
  });

  it('T2 a Pi session never brought up: not told, and nothing typed for it', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier']);
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'pier', '--name', 'night', '--prompt', PROMPT]);
    assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
    await addSkills(botYamlOf(bots, 'pier'), `kit:${KIT_SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assertNotToldPi(result, 'pier', 'night', { saysReload: false });
    // The one running beside it is told, and no tab stands in for night's.
    assertReloadedOnce(await sentToSession(box, bots, 'pier', 'daily'), 'pier/daily');
    assert.equal(toldLine(result.stdout, 'pier', 'daily').word, 'reloaded');
  });

  it('T2 a Pi session whose tab Orca no longer lists: not told, nothing typed in its place, and the Pi session beside it is still told', LIMIT, async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const bots = await botsIn(box, ['pier'], { pier: { harness: 'pi', sessions: [['daily', 'pi'], ['night', 'pi']] } });
    const up = await box.run(['up', '--bots', 'bots']);
    assert.equal(up.code, 0, `obk up: ${up.stdout}${up.stderr}`);
    const closed = (await sessionIn(bots, 'pier', 'night'))?.tab;
    await closeTab(box, closed);
    await addSkills(botYamlOf(bots, 'pier'), `kit:${KIT_SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assertNotToldPi(result, 'pier', 'night', { saysReload: false });
    const own = await terminalOf(box, bots, 'pier', 'daily');
    for (const [tab, lines] of Object.entries(await sentSinceLaunch(box))) {
      if (tab === own.tabId) assertReloadedOnce(lines, 'pier/daily');
      else assert.deepEqual(lines, [], `nothing typed into ${tab} in place of night's tab`);
    }
    assert.equal(toldLine(result.stdout, 'pier', 'daily').word, 'reloaded');
  });

  it('T2 when Orca cannot be reached: nothing typed, the Pi session not told, and told to type /reload', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier']);
    await box.orca.set({ reachable: false });
    await addSkills(botYamlOf(bots, 'pier'), `kit:${KIT_SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `the links were made; only the telling did not happen: ${result.stdout}${result.stderr}`);
    assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), []);
    assertNotToldPi(result, 'pier', 'daily', { saysReload: true });
  });

  it('T2 a Pi session\'s tab that now runs Claude Code: no /reload typed into it, not told, and told to type /reload', LIMIT, async (t) => {
    // `/reload` typed into Claude Code is text to a model.
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier']);
    await setTab(box, (await terminalOf(box, bots, 'pier', 'daily')).tabId, { agentIdentity: 'claude', foreground: 'other-harness' });
    await addSkills(botYamlOf(bots, 'pier'), `kit:${KIT_SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], 'nothing typed into a tab running another harness');
    assertNotToldPi(result, 'pier', 'daily', { saysReload: true });
  });

  it('T2 a /reload Orca refuses to send is not reported reloaded', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier']);
    await box.orca.set({ fail: { 'terminal send': { code: 'agent_prompt_blocked', message: 'orca would not take the line' } } });
    await addSkills(botYamlOf(bots, 'pier'), `kit:${KIT_SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assertNotToldPi(result, 'pier', 'daily', { saysReload: false });
  });

  // ----------------------------------------------------------------- 3. saying how Pi gets its skills

  it('S1 skills build and up say, under a bot with a Pi session, that its Pi sessions load skills from .agents/skills; a bot with none is not told so', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, up } = await fleetIn(box, ['pier', 'mixer', 'web-bot']);
    for (const bot of ['pier', 'mixer', 'web-bot']) await addSkills(botYamlOf(bots, bot), `kit:${KIT_SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    for (const [command, stdout] of [['obk up', up.stdout], ['obk skills build', result.stdout]]) {
      for (const bot of ['pier', 'mixer']) {
        assert.ok(piSkillsLine(stdout, bot), `${command} should say under ${bot} how its Pi sessions get their skills (Pi, .agents/skills), got:\n${stdout}`);
      }
      assert.deepEqual(piLinesAbout(stdout, 'web-bot'), [], `${command} says nothing of Pi under web-bot, which has no Pi session, got:\n${stdout}`);
      assert.deepEqual(piLinesAbout(stdout, 'bot-father'), [], `nor under Bot Father, got:\n${stdout}`);
    }
  });

  it('S1 skills build says it under a Pi bot whose links did not change', LIMIT, async (t) => {
    // R2 says skills build says how a Pi session gets its skills, with no
    // condition on the run.
    const box = await createSandbox(t);
    await fleetIn(box, ['pier']);
    assert.equal((await build(box)).code, 0);
    const before = await sentSinceLaunch(box);

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.ok(piSkillsLine(result.stdout, 'pier'), `got:\n${result.stdout}`);
    assert.deepEqual(await sentSinceLaunch(box), before, 'and saying so types nothing');
  });

  it('S1 a bot on Pi with no session yet: skills build and rules build still say how Pi gets its skills and what does not apply', LIMIT, async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    await botsIn(box, ['pier'], { pier: { harness: 'pi', sessions: [] } });

    const skills = await build(box);
    const rules = await box.run(['rules', 'build', '--bots', 'bots']);

    assert.equal(skills.code, 0, `${skills.stdout}${skills.stderr}`);
    assert.ok(piSkillsLine(skills.stdout, 'pier'), `skills build, got:\n${skills.stdout}`);
    assert.equal(rules.code, 0, `${rules.stdout}${rules.stderr}`);
    assert.ok(piRulesLine(rules.stdout, 'pier'), `rules build, got:\n${rules.stdout}`);
  });

  // ----------------------------------------------------------------- 4. what does not apply to Pi

  it('R1 rules build and up say, for each bot with a Pi session, that Pi has no permission rules and no hooks; a bot with none is not told so', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, up } = await fleetIn(box, ['pier', 'mixer', 'web-bot']);
    await changeARule(bots);

    const rules = await box.run(['rules', 'build', '--bots', 'bots']);

    assert.equal(rules.code, 0, `${rules.stdout}${rules.stderr}`);
    for (const [command, stdout] of [['obk up', up.stdout], ['obk rules build', rules.stdout]]) {
      for (const bot of ['pier', 'mixer']) {
        assert.ok(piRulesLine(stdout, bot), `${command} should say for ${bot} that Pi has no permission rules and no hooks, got:\n${stdout}`);
      }
      assert.deepEqual(piLinesAbout(stdout, 'web-bot'), [], `${command} says nothing of Pi for web-bot, which has no Pi session, got:\n${stdout}`);
    }
  });

  it('R1 a bot on Pi gets its AGENTS.md as any bot does, and no Claude settings, no Codex hooks and no Codex rules file', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier']);
    await changeARule(bots);
    const rules = await box.run(['rules', 'build', '--bots', 'bots']);
    assert.equal(rules.code, 0, `${rules.stdout}${rules.stderr}`);
    const again = await box.run(['up', '--bots', 'bots']);
    assert.equal(again.code, 0, `${again.stdout}${again.stderr}`);
    assert.ok(piRulesLine(rules.stdout, 'pier'), `rules build says what does not apply to Pi, got:\n${rules.stdout}`);
    assert.ok(piRulesLine(again.stdout, 'pier'), `and up says it again, got:\n${again.stdout}`);

    const block = blockIn(await agentsIn(bots, 'pier'));
    assert.equal(underIn(block.body, 'Charter'), 'pier owns its own corner.', `the charter is in its AGENTS.md, got:\n${block.body}`);
    assert.deepEqual(
      headingsIn(block.body),
      ['Charter', ...(await defaultUnits()).map((unit) => unit.title), 'The house style'],
      'the charter, the kit\'s units and the rule just added, as for any bot',
    );
    const home = botHomeOf(bots, 'pier');
    assert.equal(await exists(hookFileOf(bots, 'pier', 'claude')), false, 'no .claude/settings.json for a bot no Claude session runs in');
    assert.equal(await exists(hookFileOf(bots, 'pier', 'codex')), false, 'no .codex/hooks.json');
    assert.equal(await exists(path.join(home, '.codex', 'rules', 'obk.rules')), false, 'no Codex rules file');
  });

  it('R1 a bot with a Claude and a Pi session still gets its Claude settings and the kit\'s hooks', LIMIT, async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const bots = await botsIn(box, ['duo'], { duo: { harness: 'claude', sessions: [['daily', 'claude'], ['pier', 'pi']] } });
    const up = await box.run(['up', '--bots', 'bots']);
    assert.equal(up.code, 0, `${up.stdout}${up.stderr}`);
    const rules = await box.run(['rules', 'build', '--bots', 'bots']);
    assert.equal(rules.code, 0, `${rules.stdout}${rules.stderr}`);

    const hooks = await hooksIn(bots, 'duo', 'claude');
    assert.ok(hooks !== undefined, 'the Claude session\'s settings are written');
    assert.notDeepEqual(kitHooksIn(hooks), [], `with the kit's hooks in them, got: ${JSON.stringify(hooks)}`);
    assert.ok(piRulesLine(rules.stdout, 'duo'), `and rules build says what does not apply to its Pi session, got:\n${rules.stdout}`);
  });

  // ----------------------------------------------------------------- 5. rules build types nothing

  it('R1 rules build types nothing into any tab, the Pi tabs included', LIMIT, async (t) => {
    // A running session reads a changed AGENTS.md at its next start or
    // /reload; rules build does not type it.
    const box = await createSandbox(t);
    const { bots } = await fleetIn(box, ['pier', 'mixer']);
    await changeARule(bots);
    const from = (await box.orca.calls()).length;

    const rules = await box.run(['rules', 'build', '--bots', 'bots']);

    assert.equal(rules.code, 0, `${rules.stdout}${rules.stderr}`);
    assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal send').map((call) => call.args), [], 'nothing typed');
    const house = await readFile(path.join(botHomeOf(bots, 'pier'), 'AGENTS.md'), 'utf8');
    assert.ok(house.includes('Say it in one line.'), 'the premise: the build did write the change');
    for (const bot of ['pier', 'mixer']) assert.ok(piRulesLine(rules.stdout, bot), `rules build says for ${bot} what does not apply to Pi, and types nothing, got:\n${rules.stdout}`);
  });
});
