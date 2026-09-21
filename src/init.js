// Creates the user's bots folder: their own git repo, seeded with the files the
// kit reads, and Bot Father. The kit puts none of its own code in here — kit
// skills are linked from the installed package (ADR 0004).
//
// Seeding only ever adds what is missing. The user edits these files, by hand
// or through Bot Father, so a re-run must never write over them.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

import { changesExactly, YAML_OUT } from './bot.js';

const DEFAULTS_YAML = `# Rules and skills every bot gets, on top of its own.
#
# rules:  rule units built into every bot's AGENTS.md, on top of the kit's own
#         defaults, which every bot carries already. A bare name is a file in
#         rules/ beside this one; kit:<name> is one of the kit's.
# skills: skills every bot gets, linked into both harnesses. kit:<name> is one
#         of the kit's; <source>:<name> is one from an online source you listed
#         in skills.yaml; a bare name is a directory in skills/ beside this one;
#         anything with a / in it is a path to a skill directory on disk.

rules: []
skills: []
`;

const SKILLS_YAML = `# Online skill sources. The kit clones each one beside this folder, in
# <bots>.skill-sources/, at the ref you pin here, and records the sha it got.
#
# sources:
#   - name: someones-skills
#     repo: https://github.com/someone/skills
#     path: skills        # subfolder inside the repo, optional
#     ref: v1.2.0         # branch, tag or sha

sources: []
`;

const botFatherYaml = (harness) => `# Bot Father runs the fleet. Ask it for changes rather than editing this file.

name: bot-father
harness: ${harness}
charter: |
  Bot Father owns the fleet. It creates, changes, pauses and retires bots and
  their sessions, and keeps each bot's rules and skills in order.

  Good looks like: every bot has a charter its owner recognises, the skills it
  needs and no more, and sessions that come back after a restart.

  Ask first before: retiring a bot or a session, restarting anything, or
  changing a bot's rules in a way its owner did not ask for.
rules: []
skills: []
sessions:
  # The management session: the tab you talk to Bot Father in.
  - name: ${DAILY_SESSION}
`;

const BOT_FATHER_YAML = 'bots/bot-father/bot.yaml';

/** The management session every Bot Father has: the tab you talk to it in. */
const DAILY_SESSION = 'daily';

const seeds = (harness) => [
  ['defaults.yaml', DEFAULTS_YAML],
  ['skills.yaml', SKILLS_YAML],
  ['rules/.gitkeep', ''],
  ['skills/.gitkeep', ''],
  [BOT_FATHER_YAML, botFatherYaml(harness)],
];

// The directories the layout implies, parents before children, taken from the
// seed list so the two cannot drift apart.
const LAYOUT_DIRS = (() => {
  const dirs = new Set();
  for (const [entry] of seeds('claude')) {
    const parts = entry.split('/').slice(0, -1);
    for (let depth = 1; depth <= parts.length; depth += 1) {
      dirs.add(parts.slice(0, depth).join('/'));
    }
  }
  return [...dirs];
})();

/**
 * Create or complete the bots folder at `target`.
 * Returns { bots, created } — `created` lists what was missing, in order.
 *
 * Everything is checked before anything is written, so a folder `init` cannot
 * make usable is left exactly as it was found rather than half seeded.
 */
export function initBots(target, harness) {
  const bots = path.resolve(target);
  const SEEDS = seeds(harness);

  // The bots path is held to the same rule as everything inside it, so a link
  // to a folder on another volume is the folder it points at.
  checkKind(bots, 'folder');

  const created = [];
  mkdirSync(bots, { recursive: true });

  for (const dir of LAYOUT_DIRS) checkKind(path.join(bots, dir), 'folder');
  for (const [entry] of SEEDS) checkKind(path.join(bots, entry), 'file');
  checkBotFather(path.join(bots, BOT_FATHER_YAML), harness);

  if (!existsSync(path.join(bots, '.git'))) {
    gitInit(bots);
    created.push('.git');
  }
  checkRepo(bots);

  for (const [entry, contents] of SEEDS) {
    const file = path.join(bots, entry);
    if (existsSync(file)) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    // 'wx' so a file that appeared between the check and the write is kept.
    writeFileSync(file, contents, { flag: 'wx' });
    created.push(entry);
  }

  // A bot.yaml from an earlier version of the kit is missing what this one
  // needs. It is the user's file by now, so what is missing is filled in and
  // nothing else is touched.
  const completed = created.includes(BOT_FATHER_YAML) ? [] : completeBotFather(path.join(bots, BOT_FATHER_YAML), harness);

  return { bots, created, completed };
}

// What is already at `target` must be the kind of thing `init` needs there, or
// `init` refuses: it never moves the user's data aside to make room.
// A symlink counts by what it points at.
function checkKind(target, kind) {
  if (!follow(target, () => lstatSync(target, { throwIfNoEntry: false }))) return;

  const resolved = follow(target, () => statSync(target, { throwIfNoEntry: false }));
  if (!resolved) {
    throw new Error(`${target} is a symlink that points nowhere. Remove it, then run init again.`);
  }
  if (kind === 'folder' ? !resolved.isDirectory() : !resolved.isFile()) {
    throw new Error(`${target} is in the way: init needs a ${kind} there. Move it aside, then run init again.`);
  }
}

// Look at `target`, and say plainly when the look cannot be made at all because
// the links there run in a circle. Node reports that as ELOOP and the name of a
// call the user never made; what they need is which path is the loop and that
// nobody but them can undo it.
function follow(target, look) {
  try {
    return look();
  } catch (error) {
    if (error.code !== 'ELOOP') throw error;
    throw new Error(`${target} is a symlink loop: following it comes back to where it started. Fix the links, then run init again.`);
  }
}

// An existing `.git` is not proof of a repository, and a repository found by
// walking up to a parent is not this folder's own.
function checkRepo(bots) {
  const top = spawnSync('git', ['-C', bots, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  // Only git's record terminator comes off: trailing whitespace may be part of the folder's name.
  const toplevel = (top.stdout ?? '').replace(/\n$/, '');
  if (top.status !== 0 || toplevel === '' || realpathSync(toplevel) !== realpathSync(bots)) {
    throw new Error(`${bots} has a .git entry but is not a git repository of its own. Remove or repair it, then run init again.`);
  }
}

// git's own output is captured, not inherited: the CLI decides what the user reads.
function gitInit(bots) {
  const result = spawnSync('git', ['init', '--quiet', bots], { encoding: 'utf8' });
  if (result.error) throw new Error(`could not run git: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`git init failed in ${bots}: ${(result.stderr || '').trim()}`);
  }
}

// A bot.yaml that is already there has to be one `init` can finish. What it
// cannot finish, it refuses before anything is written, rather than guess at
// what the user meant.
function checkBotFather(file, harness) {
  if (!existsSync(file)) return;

  const doc = parseDocument(readFileSync(file, 'utf8'));
  const bot = doc.errors.length > 0 ? undefined : doc.toJS();
  if (bot === null || typeof bot !== 'object' || Array.isArray(bot)) {
    throw new Error(`${file} is not a bot: it should be a YAML mapping with a name, a harness and a list of sessions. Fix it or move it aside, then run init again.`);
  }

  // The harness is the user's, written once and never rewritten: a second init
  // naming the other one is a mistake worth stopping, not a quiet change.
  if (bot.harness !== undefined && bot.harness !== harness) {
    throw new Error(`you asked for --harness ${harness}, but Bot Father is already on ${bot.harness}, and init does not change it. Run init again with --harness ${bot.harness}, or ask Bot Father to move it.`);
  }
  if (bot.sessions !== undefined && bot.sessions !== null && !Array.isArray(bot.sessions)) {
    throw new Error(`${file} has a sessions entry that is not a list, so init cannot add Bot Father's daily session to it. Fix it, then run init again.`);
  }
}

/**
 * Fill in what an older `bot.yaml` is missing, and nothing else. Returns what
 * was completed, for the report.
 *
 * The file is edited through the YAML library, which keeps the user's comments
 * and their own values; what it reformats on the way is its business. What is
 * checked here is the thing that matters: that the file says what it said
 * before, plus the harness and the session this fills in.
 *
 * Sessions the user already has are left alone, whatever they are called. They
 * are theirs, and `up` brings up what it finds.
 */
function completeBotFather(file, harness) {
  const source = readFileSync(file, 'utf8');
  const doc = parseDocument(source);

  // What is missing is settled from the document, not from the text it is
  // written back as: a file that needs nothing is not rewritten, however the
  // library would have laid it out.
  const sessions = doc.get('sessions', true);
  const needsSession = sessions?.items === undefined || sessions.items.length === 0;
  const needsHarness = doc.get('harness') === undefined;
  if (!needsSession && !needsHarness) return [];

  if (sessions?.items === undefined) {
    doc.set('sessions', [{ name: DAILY_SESSION }]);
  } else if (needsSession) {
    sessions.flow = false;
    doc.addIn(['sessions'], { name: DAILY_SESSION });
  }
  if (needsHarness) doc.set('harness', harness);

  const text = doc.toString(YAML_OUT);

  if (!changesExactly(source, text, (was) => ({
    ...was,
    harness: was.harness ?? harness,
    sessions: was.sessions?.length > 0 ? was.sessions : [{ name: DAILY_SESSION }],
  }))) {
    throw new Error(`${file} cannot be completed without changing something else in it, so nothing was written. Give it a harness and a session by hand, then run init again.`);
  }

  writeFileSync(file, text);
  return [BOT_FATHER_YAML];
}
