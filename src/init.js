// Creates the user's bots folder: their own git repo, seeded with the files the
// kit reads, and Bot Father. The kit puts none of its own code in here — kit
// skills are linked from the installed package (ADR 0004).
//
// Seeding only ever adds what is missing. The user edits these files, by hand
// or through Bot Father, so a re-run must never write over them.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULTS_YAML = `# Rules and skills every bot gets, on top of its own.
#
# rules:  rule units compiled into each bot's AGENTS.md. A name here is a file
#         in rules/ beside this one.
# skills: skills every bot gets, for example kit:bk-tdd or common:my-skill.

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

const BOT_FATHER_YAML = `# Bot Father runs the fleet. Ask it for changes rather than editing this file.

name: bot-father
charter: |
  Bot Father owns the fleet. It creates, changes, pauses and retires bots and
  their sessions, and keeps each bot's rules and skills in order.

  Good looks like: every bot has a charter its owner recognises, the skills it
  needs and no more, and sessions that come back after a restart.

  Ask first before: retiring a bot or a session, restarting anything, or
  changing a bot's rules in a way its owner did not ask for.
rules: []
skills: []
sessions: []
`;

const SEEDS = [
  ['defaults.yaml', DEFAULTS_YAML],
  ['skills.yaml', SKILLS_YAML],
  ['rules/.gitkeep', ''],
  ['skills/.gitkeep', ''],
  ['bots/bot-father/bot.yaml', BOT_FATHER_YAML],
];

// The directories the layout implies, parents before children, taken from the
// seed list so the two cannot drift apart.
const LAYOUT_DIRS = (() => {
  const dirs = new Set();
  for (const [entry] of SEEDS) {
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
export function initBots(target) {
  const bots = path.resolve(target);

  const existing = lstatSync(bots, { throwIfNoEntry: false });
  if (existing && !existing.isDirectory()) {
    throw new Error(`${bots} exists and is not a folder.`);
  }

  const created = [];
  mkdirSync(bots, { recursive: true });

  for (const dir of LAYOUT_DIRS) checkKind(path.join(bots, dir), 'folder');
  for (const [entry] of SEEDS) checkKind(path.join(bots, entry), 'file');

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

  return { bots, created };
}

// What is already at `target` must be the kind of thing `init` needs there, or
// `init` refuses: it never moves the user's data aside to make room.
// A symlink counts by what it points at.
function checkKind(target, kind) {
  if (!lstatSync(target, { throwIfNoEntry: false })) return;

  const resolved = statSync(target, { throwIfNoEntry: false });
  if (!resolved) {
    throw new Error(`${target} is a symlink that points nowhere. Remove it, then run init again.`);
  }
  if (kind === 'folder' ? !resolved.isDirectory() : !resolved.isFile()) {
    throw new Error(`${target} is in the way: init needs a ${kind} there. Move it aside, then run init again.`);
  }
}

// An existing `.git` is not proof of a repository, and a repository found by
// walking up to a parent is not this folder's own.
function checkRepo(bots) {
  const top = spawnSync('git', ['-C', bots, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const toplevel = (top.stdout ?? '').trim();
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
