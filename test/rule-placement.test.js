// Where a rule unit lands for a Claude Code session (#768; request
// claude-session-trim, R6).
//
// A unit's front matter may say `placement: all | main | both`; none is `all`.
// AGENTS.md still holds every unit. For a Claude Code bot (a bot with a
// session, or a temp role option, on Claude Code) the kit builds CLAUDE.md as a
// regular file: AGENTS.md word for word, with the `main` units left out of the
// kit's block. The `main` and `both` units go into an appended file,
// `<bots>.prompts/<bot>/system-<sum>.md`, which every kit launch of a Claude
// Code session names with `--append-system-prompt-file`. A bot with no Claude
// Code session keeps CLAUDE.md as a link to AGENTS.md.
//
// What is held here, each test named by the point of the brief it covers:
//
//   P1. A placement other than all, main or both is refused: the bot is
//       reported failed, naming the unit's file, and nothing of it is built.
//       Other bots build as usual.
//   P2. The kit's own units: talk and profiles are main, limits is both, the
//       rest all.
//   P3. AGENTS.md holds every unit, whatever its placement.
//   P4. CLAUDE.md of a Claude Code bot: a regular file, AGENTS.md without the
//       main units, the user's own text around the block byte for byte. A
//       Codex-only, Pi-only or Codex-with-Pi bot keeps the link. The link
//       turns into the file, and back. A hand edit of AGENTS.md reaches
//       CLAUDE.md at the next build, and health names CLAUDE.md as older
//       until then. A CLAUDE.md of the user's own, a hand-edited one, one
//       with a line added at its end and one with only the sentence of its
//       begin marker edited are conflicts: CLAUDE.md is left as it is, and
//       the build, up and health name it (the architect's ruling).
//   P5. The appended file: the main and both units, at its path, named by a
//       checksum of its content; none for a bot with no Claude Code session.
//       Older files go, but for the ones a book entry names (a temporary
//       session's, a paused session's), and health calls none of those a
//       leftover. A file a book entry names stays also when the book cannot
//       be read.
//   P6. Every kit launch of a Claude Code session (up, a resume, temp make)
//       names the current appended file, as one shell word, a bots folder
//       with a space included. A Codex or Pi line never carries the flag.
//   P7. No session loses a unit: Claude Code with Codex, Claude Code with Pi,
//       a session that moves to another harness, and a main unit added when
//       the bot's prompts folder cannot be written (named by up).
//   P8. The guard: the SessionStart hook reads its harness's launch line; with
//       no flag on it, on every source, its answer holds the main units, and
//       health names the session. With the flag, no main unit. The flag is
//       an option of the line: the same words in the prompt after `--` are
//       prose, and the line is bare. The start prompt of a clear and a
//       compaction stays.
//   P9. Older system text: the hook notes which appended file a session read;
//       health and rules build name a session whose file is not the current
//       one. A resume keeps what was noted.
//
// The units here are made up. No text of Claude Code is in this file. Every
// run is in the sandbox (helpers/cli.js): its own HOME and a fake Orca. The
// hook runs under real stand-in processes whose argv carries the launch line,
// and the fake ps answers for them (helpers/cli.js recordSession,
// helpers/fake-ps.js).

import assert from 'node:assert/strict';
import { appendFile, chmod, lstat, mkdir, readdir, readFile, readlink, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bareLaunch,
  bookOf,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  harnessWordsOf,
  kitLaunchMark,
  launchLineInTab,
  recordSession,
  sessionIn,
  SYSTEM_FLAG,
  tabsOfBot,
  tokenless,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';
import { addRules, agentsOf, blockIn, headingsIn, kitUnits, sectionsIn, underIn } from './helpers/rules.js';

// ---------------------------------------------------------------- the units

/** The bot's own units, made up: one of each placement, and one with none. */
const UNITS = {
  lantern: { title: 'Lantern Duty', placement: 'main', body: 'Keep the lantern lit at the north gate until the bell rings twice.' },
  ferry: { title: 'Ferry Ledger', placement: 'both', body: 'Write each crossing of the ferry in the green ledger.' },
  orchard: { title: 'Orchard Rows', body: 'Walk the orchard rows from east to west.' },
  quarry: { title: 'Quarry Bell', placement: 'all', body: 'Ring the quarry bell once before each blast.' },
};

/** A unit file: front matter with the title and, when given, the placement as written; then the body. */
const unitFile = (title, body, placement) => `---\ntitle: ${title}\n${placement === undefined ? '' : `placement: ${placement}\n`}---\n\n${body}\n`;

/** Write one of the user's units into `<bots>/rules/<name>.md`. */
async function writeUnitFile(bots, name, { title, body, placement }) {
  await mkdir(path.join(bots, 'rules'), { recursive: true });
  await writeFile(path.join(bots, 'rules', `${name}.md`), unitFile(title, body, placement));
}

/** The titles of the kit's own units by name, from rules/*.md. */
async function kitTitles() {
  return Object.fromEntries((await kitUnits()).map((unit) => [unit.name, unit.title]));
}

/** The main and the both titles of a bot carrying the kit's units and UNITS. */
async function placed() {
  const kit = await kitTitles();
  return {
    main: [kit.talk, kit.profiles, UNITS.lantern.title],
    both: [kit.limits, UNITS.ferry.title],
    all: [UNITS.orchard.title, UNITS.quarry.title],
  };
}

const CHARTER = 'Api Bot keeps the harbour records. Good is a ledger that adds up.';
const DUTY = 'Read your instructions and keep the harbour records.';

// ---------------------------------------------------------------- the fleet

/** `obk <args>` that must work. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/**
 * A bots folder seeded on Claude Code, with each bot of `made` on its harness,
 * its charter, its sessions (`[name, settings]` each) and, unless `units` is
 * false, the units of UNITS in its bot.yaml's rules list. Not built again, not
 * brought up.
 */
async function fleet(box, { folder = 'bots', made = [{ bot: 'api-bot' }] } = {}) {
  await ok(box, ['init', '--bots', folder, '--harness', 'claude']);
  const bots = box.path(folder);
  for (const name of Object.keys(UNITS)) await writeUnitFile(bots, name, UNITS[name]);
  for (const { bot, harness = 'claude', sessions = [['daily', ['--prompt', DUTY]]], units = true } of made) {
    await ok(box, ['bot', 'create', '--bots', folder, '--name', bot, '--harness', harness, '--charter', CHARTER]);
    for (const [name, settings = []] of sessions) {
      await ok(box, ['session', 'add', '--bots', folder, '--bot', bot, '--name', name, ...settings]);
    }
    if (units) await addRules(botYamlOf(bots, bot), ...Object.keys(UNITS));
  }
  return bots;
}

const botYamlOf = (bots, bot) => path.join(botHomeOf(bots, bot), 'bot.yaml');

/** Change a bot's bot.yaml, the user's file, as a user edits it. */
async function editBotYaml(bots, bot, change) {
  const file = botYamlOf(bots, bot);
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  await writeFile(file, stringify(change(doc) ?? doc));
}

const build = (box, folder = 'bots', ...rest) => box.run(['rules', 'build', '--bots', folder, ...rest]);
const buildOk = async (box, folder = 'bots', ...rest) => ok(box, ['rules', 'build', '--bots', folder, ...rest]);

/** `obk up` for one bot, with its --json answer. */
async function up(box, bot = 'api-bot', folder = 'bots') {
  const result = await ok(box, ['up', '--bots', folder, '--bot', bot, '--json']);
  return JSON.parse(result.stdout);
}

/** A --json answer, parsed. */
function json(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON, got (${error.message}):\n${result.stdout}${result.stderr}`);
  }
}

/** The one entry of a rules list about `bot`. */
function rulesEntry(answer, bot) {
  assert.ok(Array.isArray(answer.rules), `the answer should carry a rules list, got: ${JSON.stringify(answer)}`);
  const found = answer.rules.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one rules entry should be about ${bot}, got: ${JSON.stringify(answer.rules)}`);
  return found[0];
}

/** `obk health --json`: its findings. */
async function findings(box, folder = 'bots') {
  const answer = json(await box.run(['health', '--bots', folder, '--json']));
  assert.ok(Array.isArray(answer.found), `health should answer with a list of findings, got: ${JSON.stringify(answer)}`);
  return answer.found;
}

/** Whether a finding points at `file`: as where it is, or in what it says. */
const pointsAt = (one, file) => one.where === file || (typeof one.says === 'string' && one.says.includes(file));

const show = (value) => JSON.stringify(value, null, 2);

// ---------------------------------------------------------------- the files

const claudeOf = (bots, bot) => path.join(botHomeOf(bots, bot), 'CLAUDE.md');

/** Whether a path is a symbolic link; undefined when there is nothing there. */
async function isLink(file) {
  try {
    return (await lstat(file)).isSymbolicLink();
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** CLAUDE.md is the kit's link to AGENTS.md: a link, and reading it is reading AGENTS.md. */
async function assertLinked(bots, bot, why) {
  const file = claudeOf(bots, bot);
  assert.equal(await isLink(file), true, `${why}: CLAUDE.md should be a link, got ${await isLink(file) === false ? 'a regular file' : 'nothing'}`);
  assert.equal(await realpath(file), await realpath(agentsOf(bots, bot)), `${why}: the link leads to the bot's AGENTS.md (it says ${await readlink(file)})`);
}

/** CLAUDE.md is a regular file, not a link. */
async function assertRegular(bots, bot, why) {
  const kind = await isLink(claudeOf(bots, bot));
  assert.equal(kind, false, `${why}: CLAUDE.md should be a regular file the kit built, got ${kind ? 'a link' : 'nothing'}`);
}

/** The kit's folder of start prompts for one bot. */
const promptsOf = (bots, bot) => path.join(`${bots}.prompts`, bot);

/** The appended files of a bot, `system-<hex>.md` in its prompts folder, by full path, in name order. */
async function appendedFiles(bots, bot) {
  let names;
  try {
    names = await readdir(promptsOf(bots, bot));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return names.filter((name) => /^system-[0-9a-f]+\.md$/.test(name)).sort().map((name) => path.join(promptsOf(bots, bot), name));
}

/** The one appended file of a bot. */
async function theAppended(bots, bot, why = 'the bot') {
  const files = await appendedFiles(bots, bot);
  assert.equal(files.length, 1, `${why}: there should be one system-<sum>.md in ${promptsOf(bots, bot)}, got: ${show(files)}`);
  return files[0];
}

/** A block body with the `## ` sections under `titles` left out, the rest as it was. */
function withoutSections(body, titles) {
  return body.split(/\n\n(?=## )/)
    .filter((piece) => !titles.some((title) => piece === `## ${title}` || piece.startsWith(`## ${title}\n`)))
    .join('\n\n');
}

/**
 * CLAUDE.md is AGENTS.md word for word, but for the main units: the text
 * above and below the block byte for byte, and the block's body without the
 * main sections. The begin marker's checksum is the kit's own.
 */
async function assertClaudeIsAgentsWithout(bots, bot, mainTitles) {
  await assertRegular(bots, bot, 'a Claude Code bot');
  const agents = blockIn(await readFile(agentsOf(bots, bot), 'utf8'));
  const claude = blockIn(await readFile(claudeOf(bots, bot), 'utf8'));
  assert.equal(claude.head, agents.head, 'the text above the block is AGENTS.md\'s, byte for byte');
  assert.equal(claude.tail, agents.tail, 'the text below the block is AGENTS.md\'s, byte for byte');
  assert.equal(claude.body, withoutSections(agents.body, mainTitles), 'the block is AGENTS.md\'s, without the main units');
  return { agents, claude };
}

/** The sections of an appended file are exactly `titles`, each with the body AGENTS.md gives it. */
function assertSectionsAre(text, agentsBody, titles, what) {
  const sections = sectionsIn(text);
  assert.deepEqual(sections.map((one) => one.heading).sort(), [...titles].sort(), `${what} should hold these units under their titles, got:\n${text}`);
  for (const title of titles) {
    assert.equal(sections.find((one) => one.heading === title)?.body, underIn(agentsBody, title), `${what}: ${title} as AGENTS.md has it`);
  }
}

/** Every section of AGENTS.md (the charter included) is in CLAUDE.md's block or in the appended file, word for word. */
function assertEveryUnitReaches(agentsText, claudeText, appendedText, who) {
  const agents = blockIn(agentsText).body;
  const claude = blockIn(claudeText).body;
  const appended = sectionsIn(appendedText);
  for (const { heading, body } of sectionsIn(agents)) {
    const there = underIn(claude, heading) ?? appended.find((one) => one.heading === heading)?.body;
    assert.equal(there, body, `${who}: ${heading} should reach the session through CLAUDE.md or the appended file`);
  }
  assert.equal(underIn(claude, 'Charter'), CHARTER, `${who}: the charter is in CLAUDE.md`);
}

// ---------------------------------------------------------------- the lines

/** The tab the book gives a session, and Orca's own record of it. */
async function liveTab(box, bots, bot, name) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${bot}/${name}, got: ${show(entry)}`);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${bot}/${name}'s tab ${entry.tab}`);
  return terminal;
}

/** The last launch line the kit typed into a session's tab. */
async function lineOf(box, bots, bot, name) {
  const terminal = await liveTab(box, bots, bot, name);
  const line = await launchLineInTab(box, terminal.tabId);
  assert.equal(typeof line, 'string', `the kit should have typed a launch line into ${bot}/${name}'s tab, got: ${show(terminal.typed)}`);
  return line;
}

/** The path a launch line names after the flag, as the harness gets it, or undefined; the flag at most once. */
function systemOn(line) {
  const words = harnessWordsOf(line);
  const at = words.flatMap((word, index) => (word === SYSTEM_FLAG ? [index] : []));
  assert.ok(at.length <= 1, `the flag should be on the line once at most, got: ${line}`);
  return at.length === 0 ? undefined : words[at[0] + 1];
}

/** A launch line names the bot's current appended file. */
async function assertNamesAppended(line, bots, bot, why) {
  const named = systemOn(line);
  assert.notEqual(named, undefined, `${why}: the line should carry ${SYSTEM_FLAG}, got: ${line}`);
  assert.equal(path.resolve(named), await theAppended(bots, bot, why), `${why}: it names the bot's current appended file`);
}

const FLAG_WORD = new RegExp(` ${SYSTEM_FLAG} ('(?:[^']|'\\\\'')*'|\\S+)`, 'g');

/**
 * Make a session's tab look launched by an older kit: the flag and its path
 * taken off the launch line Orca holds for it, so the harness the hook reads
 * (and the tab health reads) carries none.
 */
async function oldKitTab(box, tabId) {
  const state = await box.orca.state();
  const terminal = state.terminals.find((one) => one.tabId === tabId);
  assert.ok(terminal, `the fake Orca should have the tab ${tabId}`);
  terminal.typed = terminal.typed.map((entry) => ({ ...entry, text: entry.text.replace(FLAG_WORD, '') }));
  await box.orca.set({ terminals: state.terminals });
}

/** The session's tab is in `tabsOfBot` and its launch line carries no flag. */
const noFlag = (line, why) => assert.equal(systemOn(line), undefined, `${why}: the line should carry no ${SYSTEM_FLAG}, got: ${line}`);

/** The environment of a command run in a session's tab. */
const inTab = (box, terminal) => ({
  ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal),
});

// ---------------------------------------------------------------- the hook

/** Run the kit's hook for a session's tab; `line` as recordSession takes it. Gives back the run and its context. */
async function hook(box, { bots, bot = 'api-bot', tab, session, source, line }) {
  const ran = await recordSession(box, { bots, bot, tab, session, source, ...(line === undefined ? {} : { line }) });
  assert.equal(ran.code, 0, `the hook must never fail the session: ${ran.stderr}`);
  if (ran.stdout === '') return { ran, context: undefined };
  let answer;
  try {
    answer = JSON.parse(ran.stdout);
  } catch (error) {
    return assert.fail(`the hook's answer must be JSON, got: ${ran.stdout} (${error.message})`);
  }
  return { ran, context: answer.hookSpecificOutput?.additionalContext };
}

/** What AGENTS.md says under each of `titles`, for a check that a text holds them. */
async function bodiesIn(bots, bot, titles) {
  const body = blockIn(await readFile(agentsOf(bots, bot), 'utf8')).body;
  return titles.map((title) => {
    const text = underIn(body, title);
    assert.equal(typeof text, 'string', `the premise: AGENTS.md holds ${title}`);
    return { title, text };
  });
}

/** The context holds each unit, title and body. */
function assertHolds(context, units, why) {
  assert.equal(typeof context, 'string', `${why}: the hook should answer with context, got nothing`);
  for (const { title, text } of units) {
    assert.ok(context.includes(title), `${why}: the context should hold the title ${title}, got:\n${context}`);
    assert.ok(context.includes(text), `${why}: the context should hold the body of ${title}, got:\n${context}`);
  }
}

/** The context holds none of the units: neither title nor body. */
function assertHoldsNone(context, units, why) {
  if (context === undefined) return;
  for (const { title, text } of units) {
    assert.ok(!context.includes(text), `${why}: the context should not hold ${title}, got:\n${context}`);
  }
}

const NO_SYSTEM = 'no appended system text';
const OLDER = 'older than its bot\'s units';

/** The findings that name the session and say `phrase`. */
const namingSession = (found, bot, session, phrase) => found.filter((one) => typeof one.says === 'string'
  && one.says.includes(phrase) && one.says.includes(session) && one.says.includes(bot));

/** A main unit's body changed by hand, so the next build gives a new appended file. */
const changeLantern = (bots, body = 'Keep the lantern lit at the south gate as well.') => writeUnitFile(bots, 'lantern', { ...UNITS.lantern, body });

// Every test makes its own sandbox and runs the CLI several times, so four run at once.
describe('rule placement', { concurrency: 4 }, () => {

  // ================================================================ P1

  for (const value of ['system', '3']) {
    test(`P1 placement: ${value} is refused: the bot is failed, naming the unit's file, and its files stay as they were; another bot builds`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box, { made: [{ bot: 'api-bot' }, { bot: 'web-bot' }] });
      await buildOk(box);
      await writeFile(path.join(bots, 'rules', 'warden.md'), `---\ntitle: Warden Watch\nplacement: ${value}\n---\n\nWatch the warden's tower.\n`);
      await addRules(botYamlOf(bots, 'api-bot'), 'warden');
      const before = await filesOf(bots, 'api-bot');
      await rm(agentsOf(bots, 'web-bot'));

      const result = await build(box, 'bots', '--json');

      const answer = json(result);
      const entry = rulesEntry(answer, 'api-bot');
      assert.equal(entry.state, 'failed', `a unit with placement ${value} fails its bot, got: ${show(entry)}`);
      assert.ok(String(entry.trouble).includes(path.join('rules', 'warden.md')), `the report names the unit's file, got: ${show(entry)}`);
      assert.deepEqual(await filesOf(bots, 'api-bot'), before, 'AGENTS.md, CLAUDE.md and the appended file stay as they were');
      assert.notEqual(rulesEntry(answer, 'web-bot').state, 'failed', 'the other bot is built as usual');
      assert.match(await readFile(agentsOf(bots, 'web-bot'), 'utf8'), /obk:rules end/, 'and its AGENTS.md is written');
    });
  }

  test('P1 a refused placement builds nothing for a bot that has no files yet: they stay absent', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await writeFile(path.join(bots, 'rules', 'warden.md'), '---\ntitle: Warden Watch\nplacement: system\n---\n\nWatch the warden\'s tower.\n');
    await addRules(botYamlOf(bots, 'api-bot'), 'warden');
    await rm(agentsOf(bots, 'api-bot'), { force: true });
    await rm(claudeOf(bots, 'api-bot'), { force: true });
    await rm(promptsOf(bots, 'api-bot'), { recursive: true, force: true });

    const entry = rulesEntry(json(await build(box, 'bots', '--json')), 'api-bot');

    assert.equal(entry.state, 'failed', `got: ${show(entry)}`);
    assert.equal(await isLink(agentsOf(bots, 'api-bot')), undefined, 'no AGENTS.md');
    assert.equal(await isLink(claudeOf(bots, 'api-bot')), undefined, 'no CLAUDE.md');
    assert.deepEqual(await appendedFiles(bots, 'api-bot'), [], 'no appended file');
  });

  // ================================================================ P2, P3, P4

  test('P3 AGENTS.md holds every unit, whatever its placement, in the order it is listed', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);

    await buildOk(box);

    const kit = (await kitUnits()).filter((unit) => unit.applies === 'all').map((unit) => unit.title);
    assert.deepEqual(
      headingsIn(blockIn(await readFile(agentsOf(bots, 'api-bot'), 'utf8')).body),
      ['Charter', ...kit, ...Object.values(UNITS).map((unit) => unit.title)],
    );
  });

  test('P2 P4 a Claude Code bot\'s CLAUDE.md is a regular file: AGENTS.md without the main units (talk, profiles and its own), the user\'s text kept byte for byte', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await buildOk(box);
    const agents = agentsOf(bots, 'api-bot');
    const built = await readFile(agents, 'utf8');
    await writeFile(agents, `Notes I keep by hand.  \n\t indented, with a tab\n\n${built}\nA closing line of my own.   \n`);

    await buildOk(box);

    const { main, both, all } = await placed();
    const { claude } = await assertClaudeIsAgentsWithout(bots, 'api-bot', main);
    assert.equal(underIn(claude.body, 'Charter'), CHARTER, 'the charter is in it');
    for (const title of [...both, ...all]) assert.notEqual(underIn(claude.body, title), undefined, `${title} is in it`);
    const text = await readFile(claudeOf(bots, 'api-bot'), 'utf8');
    for (const { title, text: body } of await bodiesIn(bots, 'api-bot', main)) {
      assert.ok(!text.includes(`## ${title}`), `the main unit ${title} has no title in CLAUDE.md`);
      assert.ok(!text.includes(body), `and no body: ${title}`);
    }
  });

  test('P2 a bot with none of its own units still has main units: the kit\'s talk and profiles go to the appended file with limits', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { made: [{ bot: 'api-bot', units: false }] });

    await buildOk(box);

    const kit = await kitTitles();
    await assertClaudeIsAgentsWithout(bots, 'api-bot', [kit.talk, kit.profiles]);
    const agentsBody = blockIn(await readFile(agentsOf(bots, 'api-bot'), 'utf8')).body;
    assertSectionsAre(await readFile(await theAppended(bots, 'api-bot'), 'utf8'), agentsBody, [kit.talk, kit.profiles, kit.limits], 'the appended file');
  });

  for (const [label, made, fake] of [
    ['Codex-only', [{ bot: 'api-bot', harness: 'codex' }], false],
    ['Pi-only', [{ bot: 'api-bot', harness: 'pi' }], true],
    ['Codex with Pi', [{ bot: 'api-bot', harness: 'codex', sessions: [['daily', ['--prompt', DUTY]], ['pier', ['--harness', 'pi', '--prompt', DUTY]]] }], true],
  ]) {
    test(`P4 P5 a ${label} bot keeps CLAUDE.md as a link to AGENTS.md, and gets no appended file`, async (t) => {
      const box = await createSandbox(t);
      if (fake) await fakePi(box);
      const bots = await fleet(box, { made });

      await buildOk(box);

      await assertLinked(bots, 'api-bot', `a ${label} bot`);
      assert.deepEqual(await appendedFiles(bots, 'api-bot'), [], 'no system-<sum>.md');
    });
  }

  test('P4 a bot whose only Claude Code part is a temp role option is a Claude Code bot: CLAUDE.md is a file, and it has an appended file', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { made: [{ bot: 'api-bot', harness: 'codex' }] });
    await editBotYaml(bots, 'api-bot', (doc) => ({
      ...doc,
      temp_roles: { scout: [{ name: 'quick', harness: 'claude', model: 'sonnet', for: 'short counts' }] },
    }));

    await buildOk(box);

    const { main } = await placed();
    await assertClaudeIsAgentsWithout(bots, 'api-bot', main);
    await theAppended(bots, 'api-bot', 'a bot with a Claude Code temp role');
  });

  test('P4 the build replaces the kit\'s CLAUDE.md link with the file', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await assertLinked(bots, 'api-bot', 'the premise: bot create made the link');

    await buildOk(box);

    await assertRegular(bots, 'api-bot', 'after the build');
  });

  test('P4 a kit-built CLAUDE.md of a bot that is no longer a Claude Code bot turns back into the link', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await buildOk(box);
    await assertRegular(bots, 'api-bot', 'the premise: a Claude Code bot');
    await ok(box, ['session', 'change', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily', '--harness', 'codex']);

    await buildOk(box);

    await assertLinked(bots, 'api-bot', 'a bot that now runs on Codex alone');
  });

  for (const command of ['rules build', 'up']) {
    test(`P4 a hand edit of AGENTS.md below the block: health names CLAUDE.md as older, with the fix, and ${command} carries it into CLAUDE.md`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      await buildOk(box);
      await assertRegular(bots, 'api-bot', 'the premise');
      const agents = agentsOf(bots, 'api-bot');
      await appendFile(agents, '\nA line I added by hand.\n');
      const later = new Date(Date.now() + 10_000);
      await utimes(agents, later, later);

      const claude = claudeOf(bots, 'api-bot');
      const before = (await findings(box)).filter((one) => pointsAt(one, claude));
      assert.ok(before.length >= 1, `health should name ${claude} as older than AGENTS.md, got: ${show(await findings(box))}`);
      assert.ok(before.some((one) => one.says.includes('rules build')), `and name the fix, obk rules build, got: ${show(before)}`);

      if (command === 'up') await up(box);
      else await buildOk(box);

      const { main } = await placed();
      const { claude: built } = await assertClaudeIsAgentsWithout(bots, 'api-bot', main);
      assert.ok(built.tail.includes('A line I added by hand.'), `the line reached CLAUDE.md, got:\n${built.tail}`);
      assert.deepEqual((await findings(box)).filter((one) => pointsAt(one, claude)), [], 'and health has nothing more to say about CLAUDE.md');
    });
  }

  // The conflicts (the architect's ruling): CLAUDE.md is left byte for byte as
  // it is, build, up and health each name it with a fix, and the appended file
  // holds the main and both units as always.
  for (const [label, conflict] of [
    ['a file of the user\'s own', async (file) => {
      await rm(file);
      await writeFile(file, 'My own instructions for Claude.\n');
    }],
    ['a kit-built one edited by hand', async (file) => {
      const text = await readFile(file, 'utf8');
      assert.ok(text.includes(CHARTER), 'the premise: the built CLAUDE.md holds the charter');
      await writeFile(file, text.replace(CHARTER, 'Api Bot keeps the records, as I now say.'));
    }],
    ['a kit-built one with a line added at its end', (file) => appendFile(file, 'A line I added to CLAUDE.md.\n')],
    ['a kit-built one with only the sentence of its begin marker edited', async (file) => {
      const lines = (await readFile(file, 'utf8')).split('\n');
      const at = lines.findIndex((line) => line.startsWith('<!-- obk:rules'));
      assert.ok(at >= 0, `the premise: the built CLAUDE.md has the kit's begin marker, got:\n${lines.join('\n')}`);
      const sums = lines[at].match(/\b[0-9a-f]{16}\b/g) ?? [];
      assert.equal(sums.length, 2, `the premise: the begin marker carries two 16-hex sums, got: ${lines[at]}`);
      const edited = `${lines[at].slice(0, lines[at].lastIndexOf(sums[1]) + sums[1].length)} — a sentence of my own, typed by hand. -->`;
      assert.notEqual(edited, lines[at], 'the premise: the sentence changed');
      assert.deepEqual(edited.match(/\b[0-9a-f]{16}\b/g), sums, 'the premise: both sums are kept as they were');
      lines[at] = edited;
      await writeFile(file, lines.join('\n'));
    }],
  ]) {
    test(`P4 P5 CLAUDE.md as ${label} is a conflict: left as it is, named by rules build, up and health, and the appended file holds main and both`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      await buildOk(box);
      await assertRegular(bots, 'api-bot', 'the premise: the build made CLAUDE.md a file');
      const file = claudeOf(bots, 'api-bot');
      await conflict(file);
      const held = await readFile(file, 'utf8');
      await writeUnitFile(bots, 'ferry', { ...UNITS.ferry, body: 'Write each crossing in the blue ledger now.' });
      const named = path.join('api-bot', 'CLAUDE.md');

      const built = rulesEntry(json(await build(box, 'bots', '--json')), 'api-bot');
      assert.ok(String(built.trouble).includes(named), `rules build names the conflict, got: ${show(built)}`);
      assert.ok(String(built.trouble).includes('AGENTS.md'), `with the fix, which goes through AGENTS.md, got: ${show(built)}`);
      assert.equal(await readFile(file, 'utf8'), held, 'CLAUDE.md is byte for byte as it was');
      const { main, both } = await placed();
      const agentsBody = blockIn(await readFile(agentsOf(bots, 'api-bot'), 'utf8')).body;
      assertSectionsAre(await readFile(await theAppended(bots, 'api-bot'), 'utf8'), agentsBody, [...main, ...both], 'the appended file');

      const brought = rulesEntry(await up(box), 'api-bot');
      assert.ok(String(brought.trouble).includes(named), `up names the conflict, got: ${show(brought)}`);
      assert.ok(String(brought.trouble).includes('AGENTS.md'), `with the fix, got: ${show(brought)}`);
      assert.equal(await readFile(file, 'utf8'), held, 'up leaves CLAUDE.md as it was too');

      const found = (await findings(box)).filter((one) => pointsAt(one, file));
      assert.ok(found.length >= 1, `health names ${file}, got: ${show(await findings(box))}`);
    });
  }

  test('P4 a line added at the end of CLAUDE.md, moved into AGENTS.md below the block with CLAUDE.md put back, is in the next CLAUDE.md byte for byte', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await buildOk(box);
    await assertRegular(bots, 'api-bot', 'the premise');
    const file = claudeOf(bots, 'api-bot');
    const asBuilt = await readFile(file, 'utf8');
    const line = 'A line I added to CLAUDE.md.\n';
    await appendFile(file, line);
    const refused = rulesEntry(json(await build(box, 'bots', '--json')), 'api-bot');
    assert.ok(String(refused.trouble).includes(path.join('api-bot', 'CLAUDE.md')), `the premise: a conflict, got: ${show(refused)}`);

    await writeFile(file, asBuilt);
    await appendFile(agentsOf(bots, 'api-bot'), line);
    const entry = rulesEntry(json(await build(box, 'bots', '--json')), 'api-bot');

    assert.equal(entry.trouble, undefined, `no conflict any more, got: ${show(entry)}`);
    const { main } = await placed();
    const { claude } = await assertClaudeIsAgentsWithout(bots, 'api-bot', main);
    assert.ok(claude.tail.endsWith(line), `the line is at the end of CLAUDE.md, got:\n${claude.tail}`);
  });

  // ================================================================ P5

  test('P5 the appended file is <bots>.prompts/<bot>/system-<hex>.md with the main and both units, no all unit; same content keeps its name, new content a new one', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);

    await buildOk(box);

    const { main, both, all } = await placed();
    const first = await theAppended(bots, 'api-bot');
    const text = await readFile(first, 'utf8');
    const agentsBody = blockIn(await readFile(agentsOf(bots, 'api-bot'), 'utf8')).body;
    assertSectionsAre(text, agentsBody, [...main, ...both], 'the appended file');
    for (const { title, text: body } of await bodiesIn(bots, 'api-bot', all)) {
      assert.ok(!text.includes(body), `the all unit ${title} is not in it`);
    }

    await buildOk(box);
    assert.equal(await theAppended(bots, 'api-bot', 'a build with nothing changed'), first, 'the same content keeps its name');

    await changeLantern(bots);
    await buildOk(box);
    const second = await theAppended(bots, 'api-bot', 'after a main unit changed (no book entry names the old file)');
    assert.notEqual(second, first, 'new content, new name');
    assert.ok((await readFile(second, 'utf8')).includes('south gate'), 'with the new text');
  });

  test('P5 an older appended file that a paused session\'s book entry names is kept, and health calls none a leftover', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { made: [{ bot: 'api-bot', sessions: [['daily', ['--prompt', DUTY]], ['nightly', ['--prompt', DUTY]]] }] });
    await up(box);
    const old = await theAppended(bots, 'api-bot', 'after up');
    const nightly = await liveTab(box, bots, 'api-bot', 'nightly');
    await assertNamesAppended(await lineOf(box, bots, 'api-bot', 'nightly'), bots, 'api-bot', 'the premise: nightly\'s line');
    await hook(box, { bots, tab: nightly.tabId, session: 'sess-night', source: 'startup' });
    await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, 'api-bot'), id: 'sess-night' });
    await ok(box, ['pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'nightly']);

    await changeLantern(bots);
    await build(box); // a session on the older file may be named, and its exit code is the kit's

    const files = await appendedFiles(bots, 'api-bot');
    assert.ok(files.includes(old), `the paused session's file is kept, got: ${show(files)}`);
    assert.equal(files.length, 2, `and the current one is there beside it, got: ${show(files)}`);
    const leftovers = (await findings(box)).filter((one) => one.kind === 'leftover' && files.some((file) => pointsAt(one, file)));
    assert.deepEqual(leftovers, [], 'health calls neither file a leftover');
  });

  test('P5 an older appended file that a temporary session\'s book entry names is kept, and health calls none a leftover', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await up(box);
    const old = await theAppended(bots, 'api-bot', 'after up');
    const maker = await liveTab(box, bots, 'api-bot', 'daily');
    await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Count the crates on the pier.'], { env: inTab(box, maker) });
    const scout = await liveTab(box, bots, 'api-bot', 'scout');
    await assertNamesAppended(await lineOf(box, bots, 'api-bot', 'scout'), bots, 'api-bot', 'the premise: scout\'s line');
    await hook(box, { bots, tab: scout.tabId, session: 'sess-scout', source: 'startup' });

    await changeLantern(bots);
    await build(box); // a session on the older file may be named, and its exit code is the kit's

    const files = await appendedFiles(bots, 'api-bot');
    assert.ok(files.includes(old), `the temporary session's file is kept, got: ${show(files)}`);
    assert.equal(files.length, 2, `and the current one is there beside it, got: ${show(files)}`);
    const leftovers = (await findings(box)).filter((one) => one.kind === 'leftover' && files.some((file) => pointsAt(one, file)));
    assert.deepEqual(leftovers, [], 'health calls neither file a leftover');
  });

  test('P5 an older appended file that a book entry names is kept when the book cannot be read', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await up(box);
    const old = await theAppended(bots, 'api-bot', 'after up');
    const daily = await liveTab(box, bots, 'api-bot', 'daily');
    await assertNamesAppended(await lineOf(box, bots, 'api-bot', 'daily'), bots, 'api-bot', 'the premise: daily\'s line');
    await hook(box, { bots, tab: daily.tabId, session: 'sess-day', source: 'startup' });
    await writeUnitFile(bots, 'beacon', { title: 'Beacon Watch', placement: 'main', body: 'Light the beacon on the cliff when a sail is seen at dusk.' });
    await addRules(botYamlOf(bots, 'api-bot'), 'beacon');
    await build(box); // a session on the older file may be named, and its exit code is the kit's
    const kept = await appendedFiles(bots, 'api-bot');
    assert.ok(kept.includes(old) && kept.length === 2, `the premise: the book names the older file, so the build kept it beside the new one, got: ${show(kept)}`);
    const book = bookOf(bots, 'api-bot');
    await chmod(book, 0o000);
    try {
      await build(box); // whether it names the book it cannot read is the kit's

      const files = await appendedFiles(bots, 'api-bot');
      assert.ok(files.includes(old), `the file daily's book entry names is kept, also when the book cannot be read, got: ${show(files)}`);
    } finally {
      await chmod(book, 0o644);
    }
  });

  // ================================================================ P6

  test('P6 up launches a Claude Code session with the flag naming the current appended file; the rest of the line as before', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { made: [{ bot: 'api-bot', sessions: [['daily']] }] });

    await up(box);

    const line = await lineOf(box, bots, 'api-bot', 'daily');
    await assertNamesAppended(line, bots, 'api-bot', 'up');
    assert.equal(tokenless(line), bareLaunch(box, 'claude', 'api-bot', 'daily'), 'the line, pinned whole');
  });

  test('P6 a bots folder with a space in its name: the appended file\'s path is one shell word', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { folder: 'my bots', made: [{ bot: 'api-bot', sessions: [['daily']] }] });

    await up(box, 'api-bot', 'my bots');

    const line = await lineOf(box, bots, 'api-bot', 'daily');
    await assertNamesAppended(line, bots, 'api-bot', 'a folder with a space');
    assert.equal(tokenless(line), bareLaunch(box, 'claude', 'api-bot', 'daily', { bots }), 'the line, pinned whole');
  });

  test('P6 a resume carries the flag naming the current appended file', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { made: [{ bot: 'api-bot', sessions: [['daily']] }] });
    await up(box);
    const first = await liveTab(box, bots, 'api-bot', 'daily');
    await hook(box, { bots, tab: first.tabId, session: 'sess-1', source: 'startup' });
    await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, 'api-bot'), id: 'sess-1' });
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== first.tabId) });

    await up(box);

    const line = await lineOf(box, bots, 'api-bot', 'daily');
    assert.ok(line.includes('--resume sess-1'), `the premise: a resume, got: ${line}`);
    await assertNamesAppended(line, bots, 'api-bot', 'a resume');
    assert.equal(tokenless(line), `${bareLaunch(box, 'claude', 'api-bot', 'daily')} --resume sess-1`, 'the line, pinned whole');
  });

  test('P6 a temporary Claude Code session carries the flag naming the current appended file', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await up(box);
    const maker = await liveTab(box, bots, 'api-bot', 'daily');

    await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Count the crates on the pier.'], { env: inTab(box, maker) });

    await assertNamesAppended(await lineOf(box, bots, 'api-bot', 'scout'), bots, 'api-bot', 'temp make');
  });

  test('P6 a Codex bot\'s and a Pi bot\'s launch lines carry no flag', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const bots = await fleet(box, { made: [{ bot: 'api-bot', harness: 'codex' }, { bot: 'pi-bot', harness: 'pi' }] });

    await up(box, 'api-bot');
    await up(box, 'pi-bot');

    noFlag(await lineOf(box, bots, 'api-bot', 'daily'), 'Codex');
    noFlag(await lineOf(box, bots, 'pi-bot', 'daily'), 'Pi');
  });

  // ================================================================ P7

  for (const [label, other, fake] of [['Codex', 'codex', false], ['Pi', 'pi', true]]) {
    test(`P7 Claude Code with ${label}: the ${label} session reads AGENTS.md with every unit and has no flag; the Claude Code session gets every unit from CLAUDE.md and its appended file`, async (t) => {
      const box = await createSandbox(t);
      if (fake) await fakePi(box);
      const bots = await fleet(box, { made: [{ bot: 'api-bot', sessions: [['daily', ['--prompt', DUTY]], ['pier', ['--harness', other, '--prompt', DUTY]]] }] });

      await up(box);

      noFlag(await lineOf(box, bots, 'api-bot', 'pier'), `the ${label} session`);
      const agents = await readFile(agentsOf(bots, 'api-bot'), 'utf8');
      const kit = (await kitUnits()).filter((unit) => unit.applies === 'all').map((unit) => unit.title);
      assert.deepEqual(headingsIn(blockIn(agents).body), ['Charter', ...kit, ...Object.values(UNITS).map((unit) => unit.title)], 'AGENTS.md holds every unit');
      const line = await lineOf(box, bots, 'api-bot', 'daily');
      await assertNamesAppended(line, bots, 'api-bot', 'the Claude Code session');
      await assertRegular(bots, 'api-bot', 'a two-harness bot with a Claude Code session');
      assertEveryUnitReaches(agents, await readFile(claudeOf(bots, 'api-bot'), 'utf8'), await readFile(path.resolve(systemOn(line)), 'utf8'), 'the Claude Code session');
    });
  }

  test('P7 a Claude Code session that moves to Codex starts on Codex with no flag, and AGENTS.md holds every unit', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { made: [{ bot: 'api-bot', sessions: [['daily', ['--prompt', DUTY]], ['nightly', ['--prompt', DUTY]]] }] });
    await up(box);
    const nightly = await liveTab(box, bots, 'api-bot', 'nightly');
    await hook(box, { bots, tab: nightly.tabId, session: 'sess-night', source: 'startup' });
    await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, 'api-bot'), id: 'sess-night' });

    await ok(box, ['session', 'change', '--bots', 'bots', '--bot', 'api-bot', '--session', 'nightly', '--harness', 'codex']);
    await ok(box, ['restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'nightly']);

    const line = await lineOf(box, bots, 'api-bot', 'nightly');
    assert.equal(harnessWordsOf(line)[0], 'codex', `the premise: nightly starts on Codex, got: ${line}`);
    noFlag(line, 'nightly on Codex');
    const kit = (await kitUnits()).filter((unit) => unit.applies === 'all').map((unit) => unit.title);
    assert.deepEqual(
      headingsIn(blockIn(await readFile(agentsOf(bots, 'api-bot'), 'utf8')).body),
      ['Charter', ...kit, ...Object.values(UNITS).map((unit) => unit.title)],
      'AGENTS.md holds every unit',
    );
  });

  test('P7 a Codex session that moves to Claude Code starts with the flag, and CLAUDE.md and its appended file hold every unit', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { made: [{ bot: 'api-bot', sessions: [['daily', ['--prompt', DUTY]], ['nightly', ['--harness', 'codex', '--prompt', DUTY]]] }] });
    await up(box);
    const nightly = await liveTab(box, bots, 'api-bot', 'nightly');
    await hook(box, { bots, tab: nightly.tabId, session: 'sess-night', source: 'startup' });
    await conversationOnRecord(box, { harness: 'codex', cwd: botHomeOf(bots, 'api-bot'), id: 'sess-night' });

    await ok(box, ['session', 'change', '--bots', 'bots', '--bot', 'api-bot', '--session', 'nightly', '--harness', 'claude']);
    await ok(box, ['restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'nightly']);

    const line = await lineOf(box, bots, 'api-bot', 'nightly');
    assert.equal(harnessWordsOf(line)[0], 'claude', `the premise: nightly starts on Claude Code, got: ${line}`);
    await assertNamesAppended(line, bots, 'api-bot', 'nightly on Claude Code');
    assertEveryUnitReaches(
      await readFile(agentsOf(bots, 'api-bot'), 'utf8'),
      await readFile(claudeOf(bots, 'api-bot'), 'utf8'),
      await readFile(path.resolve(systemOn(line)), 'utf8'),
      'nightly on Claude Code',
    );
  });

  test('P7 a main unit added when the prompts folder cannot be written still reaches the Claude Code session, and up names the failure', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { made: [{ bot: 'api-bot', sessions: [['daily']] }] });
    await buildOk(box);
    await theAppended(bots, 'api-bot', 'the premise: the good build wrote the appended file');
    const beacon = { title: 'Beacon Watch', placement: 'main', body: 'Light the beacon on the cliff when a sail is seen at dusk.' };
    await writeUnitFile(bots, 'beacon', beacon);
    await addRules(botYamlOf(bots, 'api-bot'), 'beacon');
    const folder = promptsOf(bots, 'api-bot');
    await chmod(folder, 0o555);
    try {
      const answer = json(await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']));

      const entry = rulesEntry(answer, 'api-bot');
      assert.ok(String(entry.trouble).includes(folder), `up names what it could not write in ${folder}, got: ${show(entry)}`);
      const [unit] = await bodiesIn(bots, 'api-bot', [beacon.title]);
      const line = await lineOf(box, bots, 'api-bot', 'daily');
      const named = systemOn(line);
      const appended = named === undefined ? '' : await readFile(path.resolve(named), 'utf8');
      const tab = (await liveTab(box, bots, 'api-bot', 'daily')).tabId;
      const { context } = await hook(box, { bots, tab, session: 'sess-A', source: 'startup' });
      const roads = {
        'CLAUDE.md': await readFile(claudeOf(bots, 'api-bot'), 'utf8'),
        [`the appended file the line names (${named})`]: appended,
        'the hook\'s context': context ?? '',
      };
      const reached = Object.keys(roads).filter((road) => roads[road].includes(unit.title) && roads[road].includes(unit.text));
      assert.ok(reached.length >= 1, `the main unit ${unit.title} should reach the session by at least one road, and reached none:\n${show(roads)}`);
    } finally {
      await chmod(folder, 0o755);
    }
  });

  // ================================================================ P8

  // The upgrade case: an older kit launched the session, so its line has no
  // flag, and the new build has made CLAUDE.md a file without the main units.
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    test(`P8 a Claude Code session whose launch line has no flag gets the main units from the hook on ${source}, and health names it`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      await up(box);
      await assertRegular(bots, 'api-bot', 'the premise: the new build made CLAUDE.md a file');
      const tab = (await liveTab(box, bots, 'api-bot', 'daily')).tabId;
      await oldKitTab(box, tab);
      if (source !== 'startup') await hook(box, { bots, tab, session: 'sess-A', source: 'startup' });

      const { context } = await hook(box, { bots, tab, session: source === 'clear' ? 'sess-B' : 'sess-A', source });

      const { main } = await placed();
      assertHolds(context, await bodiesIn(bots, 'api-bot', main), `on ${source} with no flag`);
      if (source === 'clear' || source === 'compact') {
        assert.ok(context.includes(DUTY), `the start prompt is still in the answer on ${source}, got:\n${context}`);
      }
      const found = await findings(box);
      assert.ok(namingSession(found, 'api-bot', 'daily', NO_SYSTEM).length >= 1, `health names the session (${NO_SYSTEM}), got: ${show(found)}`);
    });
  }

  test('P8 with the flag on its line the hook gives no main unit, on any source; a clear and a compaction still get the start prompt alone', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await up(box);
    const tab = (await liveTab(box, bots, 'api-bot', 'daily')).tabId;
    await assertNamesAppended(await launchLineInTab(box, tab), bots, 'api-bot', 'the premise: the line has the flag');
    const { main } = await placed();
    const units = await bodiesIn(bots, 'api-bot', main);

    const started = await hook(box, { bots, tab, session: 'sess-A', source: 'startup' });
    const resumed = await hook(box, { bots, tab, session: 'sess-A', source: 'resume' });
    const compacted = await hook(box, { bots, tab, session: 'sess-A', source: 'compact' });
    const cleared = await hook(box, { bots, tab, session: 'sess-B', source: 'clear' });

    assertHoldsNone(started.context, units, 'startup');
    assertHoldsNone(resumed.context, units, 'resume');
    assert.equal(compacted.context, DUTY, 'a compaction gets the start prompt, and nothing more');
    assert.equal(cleared.context, DUTY, 'a clear gets the start prompt, and nothing more');
    const found = await findings(box);
    assert.deepEqual(namingSession(found, 'api-bot', 'daily', NO_SYSTEM), [], 'health has no such finding');
  });

  test('P8 a line with no flag whose prompt after -- names the flag in prose is bare: the hook gives the main units, as for the line without that prose', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await up(box);
    const tab = (await liveTab(box, bots, 'api-bot', 'daily')).tabId;
    const launched = harnessWordsOf(await launchLineInTab(box, tab));
    const flagAt = launched.indexOf(SYSTEM_FLAG);
    assert.ok(flagAt > 0, `the premise: the kit's line has the flag, got: ${show(launched)}`);
    const options = launched.filter((word, at) => at !== flagAt && at !== flagAt + 1);
    const end = options.indexOf('--');
    const head = end < 0 ? options : options.slice(0, end);
    const plain = [...head, '--', 'Read the harbour notes before you start.'];
    const prose = [...head, '--', `Read the harbour notes on ${SYSTEM_FLAG} before you start.`];
    const { main } = await placed();
    const units = await bodiesIn(bots, 'api-bot', main);

    const without = await hook(box, { bots, tab, session: 'sess-A', source: 'startup', line: plain });
    const withProse = await hook(box, { bots, tab, session: 'sess-B', source: 'startup', line: prose });

    assertHolds(without.context, units, `the premise: a line with no flag (${plain.join(' ')})`);
    assertHolds(withProse.context, units, `a line with no flag whose prompt names it in prose (${prose.join(' ')})`);
  });

  // ================================================================ P9

  test('P9 a session that read an older appended file is named by health and rules build; one on the current file is not', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { made: [{ bot: 'api-bot', sessions: [['daily', ['--prompt', DUTY]], ['nightly', ['--prompt', DUTY]]] }] });
    await up(box);
    const daily = (await liveTab(box, bots, 'api-bot', 'daily')).tabId;
    await assertNamesAppended(await launchLineInTab(box, daily), bots, 'api-bot', 'the premise');
    await hook(box, { bots, tab: daily, session: 'sess-day', source: 'startup' });
    assert.deepEqual(namingSession(await findings(box), 'api-bot', 'daily', OLDER), [], 'on the current file: no finding');

    await changeLantern(bots);
    const built = await build(box);

    assert.ok(`${built.stdout}${built.stderr}`.includes(OLDER) && `${built.stdout}${built.stderr}`.includes('daily'), `rules build names the session, got:\n${built.stdout}${built.stderr}`);
    const found = await findings(box);
    assert.ok(namingSession(found, 'api-bot', 'daily', OLDER).length >= 1, `health names daily (${OLDER}), got: ${show(found)}`);
    assert.deepEqual(namingSession(found, 'api-bot', 'nightly', OLDER), [], 'nightly reported nothing, so health says nothing of it');
  });

  test('P9 a resume keeps the file noted before; a clear on a line naming the current file brings the session up to date', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await up(box);
    const tab = (await liveTab(box, bots, 'api-bot', 'daily')).tabId;
    const launched = await launchLineInTab(box, tab);
    await assertNamesAppended(launched, bots, 'api-bot', 'the premise');
    await hook(box, { bots, tab, session: 'sess-A', source: 'startup' });
    await changeLantern(bots);
    await build(box); // a session on the older file may be named, and its exit code is the kit's
    const current = (await appendedFiles(bots, 'api-bot')).filter((file) => file !== path.resolve(systemOn(launched)));
    assert.equal(current.length, 1, `the premise: one new appended file, got: ${show(await appendedFiles(bots, 'api-bot'))}`);
    const onNew = harnessWordsOf(launched).map((word) => (word === systemOn(launched) ? current[0] : word));

    await hook(box, { bots, tab, session: 'sess-A', source: 'resume', line: onNew });
    assert.ok(namingSession(await findings(box), 'api-bot', 'daily', OLDER).length >= 1, 'a resume keeps the older file it noted');

    await hook(box, { bots, tab, session: 'sess-B', source: 'clear', line: onNew });
    assert.deepEqual(namingSession(await findings(box), 'api-bot', 'daily', OLDER), [], 'a clear with the current file on its line is up to date');
  });
});

/**
 * What a refused build must leave as it was for one bot: AGENTS.md and
 * CLAUDE.md (what each is and says) and the bot's prompts folder.
 */
async function filesOf(bots, bot) {
  const read = async (file) => {
    const kind = await isLink(file);
    if (kind === undefined) return null;
    return kind ? { link: await readlink(file) } : { text: await readFile(file, 'utf8') };
  };
  const prompts = {};
  for (const file of await appendedFiles(bots, bot)) prompts[path.basename(file)] = await readFile(file, 'utf8');
  return { agents: await read(agentsOf(bots, bot)), claude: await read(claudeOf(bots, bot)), prompts };
}
