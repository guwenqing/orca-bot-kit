# Bot Kit on Orca — design PRD

Date: 2026-09-19. Status: draft for owner review.

This PRD replaces the Codex-desktop plan (Request #9, Epic #11 and its children).
The old content has been removed from the tree, the process tooling included; git history has it if intent needs checking.
Decisions with lasting consequences are in [`docs/adr/`](adr/).

Every item is marked:

- **[decided]** — the owner said so in the design session.
- **[decided — blanket]** — covered by a blanket acceptance ("the round 1 you are right", "THE REST IS OK"), not by a specific statement.
- **[proposed]** — the assistant's proposal; the owner has not confirmed it. Strike or change freely.

Sections 3 and 4 describe the outcome; the tags in sections 5 to 8 govern what is decided.

This PRD says what is wanted and where the limits are. It does not say how to build it: names of commands, files, flags and fields are the builder's to choose, and facts about Orca and the harnesses live in `tech-notes.md`.

## 1. Problem

A person wants a small fleet of long-lived role bots on their own computer:
a manager, developers, reviewers, a personal helper.
Each bot keeps its identity, rules, skills and sessions across restarts.
The person manages everything by talking to an LLM, not by editing files.

The first attempt used Codex desktop projects as the host.
It failed on host limits (permissions, project visibility, manual steps) and on heavy process.
The owner already runs a similar setup on Orca elsewhere. This product is the Orca version.

## 2. Who it is for

- The owner first, but the kit is not only for the owner. [decided]
- People who are not programmers should be able to run it through Bot Father. [decided, from Request #9]

## 3. What the user can do

1. Install the kit with npm, run one init, and get Bot Father running in Orca.
2. Ask Bot Father to create, change, pause or retire bots and sessions.
3. Give each bot its own rules (`AGENTS.md`) and its own set of skills.
4. Use skills from the kit, from their own folder, from an online repo at a pinned version, or from anywhere on disk.
5. Run several sessions per bot, on Claude Code or Codex, each with its own model, effort, context, approval level and start prompt.
6. Restart the computer, or kill a tab, and get every session back with its history.
7. `/clear` a session and keep a record of the old session id.
8. Let sessions and bots message each other without disturbing normal work.
9. Get a daily grooming report: how the bots are doing, what to improve, and what it costs.
10. Give code-writing bots a working methodology: TDD with a separate test author, mutation testing, a separate reviewer, debugging, architecture.

## 4. How we will know it works

Each line is a check a developer can run. Issues turn these into acceptance tests.

1. After `npm link` and `obk init`, an Orca project "Bot Father" exists with a daily session tab and an ops tab; the bots folder is a git repo and contains no kit code.
2. `obk` creates a bot on Claude Code and a bot on Codex; each starts at its bot home and reads its `AGENTS.md`.
3. A session created with a start prompt receives it once; after `/clear` it receives it again automatically.
4. After `/clear`, the book holds the new session id and the old id is in that session's history.
5. After a tab is closed (or a reboot), bringing the fleet up restores the session with its conversation.
6. A skill added or changed through the kit is usable in a running session without a restart.
7. A skill from an online repo is cloned outside the bots repo at the pinned ref and linked into the bot, for both harnesses.
8. A bot's `AGENTS.md` is rebuilt from kit rules + user rules + bot overrides; text outside the managed region survives; a hand edit inside it stops the build.
9. A Claude session and a Codex session exchange a message and a reply; a busy receiver is not interrupted.
10. A grooming run produces a short report in Bot Father's daily session that names at least: one usage figure per session, and any sign of a bot in trouble that it found.
11. A developer bot using the TDD skill produces: a failing test first, a test written by a separate author, and a mutation result.
12. The kit can report plainly what is wrong with a setup: conflicting or broken configuration, a broken skill link, a session the book knows that Orca does not, leftovers no book owns.

## 5. What we are not doing

- No AssuredLoop, OpenSpec or other process framework in this repo for now. [decided]
- No Codex-desktop integration; no sidebar, phone or remote work — Orca does that. [decided]
- No Claude handoff / "consult Claude" skill; Claude is a first-class harness. [decided]
- No panel discussion yet. [decided]
- No process or phases in the skills; no research-plan-implement. [decided]
- No kit-owned expert systems (pattern lists, guard scripts). [decided]
- No prescribed PRD format or issue tracker for users of the skills. [decided]
- No performance skill. [decided]
- No cloud execution. [proposed — carried from Request #9]

## 6. Product

### 6.1 Shape

- An npm package with a CLI and skills. Installed with `npm install`; `npm link` for now. [decided]
- Everything, skills included, comes from the package. [decided]
- The user manages bots, skills and prompts through an LLM — normally Bot Father's management session, whose skills call the CLI. [decided]
- The harnesses are assumed to be installed and configured. [decided]
- The repo is `orca-bot-kit`. [decided] The npm package is `orca-bot-kit` and the command is `obk`, run system-wide through `npm link`. [decided]

### 6.2 Host

- Orca. A bot is an Orca project; a session is a tab. Naming, ordering, phone and remote access are Orca's. [decided] → ADR 0001
- A bot's Orca project is a folder workspace; many tabs share it. Proven live: a git-kind registration of a folder inside the bots repo gets no worktree and cannot host tabs. So a bot's project shows no git status in Orca. [decided by the coordinator on evidence]
- Everything is in the book except one special tab. A session's Orca tab id and the bot's Orca project id live in the book with the session. The only exception is Bot Father's ops tab for whole-fleet maintenance. The kit does not track it at all: no id, no title matching, no session id, no history, not seen by grooming. The kit only makes sure it exists: if Bot Father's Orca project has no tab besides the ones in the book, `obk up` creates one (and sets its title). Nothing more. [decided]
- The kit always tries to set a tab's title to the name in the book, and never reads or relies on what a tab is currently called; the tab id is the key. [decided] (Observed: titles can change even with Orca's dynamic title option off, because the program in the tab writes its own title.)
- A bot home is a plain folder. The kit never creates a git worktree for the bots repo or for a bot, and never registers a bot folder in Orca as a git repo. Orca calls every workspace a "worktree"; the kit's output and docs say "Orca project" or "folder workspace". [decided]
- `obk init` takes `--harness claude|codex` with no silent default and no interactive prompt; the setup step asks the user once and passes it. [decided by the coordinator]

### 6.3 Workspace

- All bots live in one folder, and that folder is one git repo for all bots. It is local; the user may push it. [decided]
- The kit does not copy its code or skills into it unless the user wants that; kit skills are links to the installed package. [decided] → ADR 0004
- Inside that repo: what every bot gets by default, the user's own rules and common skills, the list of online skill sources, and one folder per bot holding its charter and settings, its book of sessions, its `AGENTS.md`, its skills, its shared notes and its work area. Clones of online skill sources sit beside the bots repo, never inside it. File and folder names are the builder's choice. [decided in substance]
- `work/` is gitignored. [decided — blanket]
- Per-bot `memory/`: plain notes all sessions of the bot can read and write; "remember this" writes there; writing does not message other sessions. [decided]

- Writing is not banned anywhere: an AI acting on the user's instruction may write whatever the user asks, user-level settings included. What the kit's own mechanical code writes is narrower: it writes the files the kit manages in the bots repo, and it does not reach into the user's global or user-level settings by itself. When that code edits a file that also holds the user's own text, it keeps what the user wrote and leaves a valid file, using the standard library for the format. [decided]

### 6.4 Bots and sessions

- Sessions of one bot share the bot home. One bot may have several sessions. [decided]
- Every session starts at the bot home. A per-session work dir is an instruction only and is always a plain folder; the kit creates it and adds the note to the start prompt automatically. It has nothing to do with git worktrees. When a bot clones a repo into its work dir and works on it, it honours that repo's own rules; whether it clones, uses a worktree there, or does something else is for the user to say. [decided]
- Each session sets: harness, model, effort, context window, approval level, start prompt. [decided]
- The kit never hardcodes a model id; empty means the harness default. Init asks once for the harness. [decided]
- Approval levels: `auto` (default; the harness's real auto mode), `ask`, `dangerously-skip` (only when the user asks for it in plain words). [decided] → ADR 0005
- Each approval level maps to the harness's own flags; the mapping is a fact kept in `tech-notes.md` and re-checked when a harness updates. A session can carry extra launch arguments the kit does not know about. [decided in substance]
- A start prompt goes to the harness from a file, unless it is very short and simple, in which case it can go as plain text. Either way it arrives unchanged. [decided]
- Start prompt: sent once when the tab is created; not re-sent on resume; **re-sent automatically after `/clear`**. It is the only thing that tells one session's duty from another's when they start in different tabs. [decided]
- Bot creation can resume an external existing session. Setup is done through an LLM, now and later through Bot Father, and that LLM does its best to help the user migrate the rest. [decided]

### 6.5 Session identity

- The kit's book is the authority for session ids. Orca loses its resume record when a tab is closed. [decided] → ADR 0002
- The kit learns a session's new id whenever the session starts, resumes or is cleared, and keeps the old one in that session's history. Whatever it installs for this lives in the bot's own folder, never in user-level settings. [decided] → ADR 0010
- `/clear` and compact are supported. `/clear` always makes the harness generate a new session id (certain for Claude Code, likely the same for Codex). The old ids are kept, for history, auditing, finops or whatever needs them. `/clear` means the user wants a clean start; no handoff happens automatically. [decided]
- Session ids are remembered across a restart, whether from a computer restart or one asked for by Bot Father. [decided]
- When skills change, Bot Father's management skill knows how to reload them without a restart. [decided]
- Bringing the fleet up is safe to repeat: it restores what is missing and never closes or disturbs what is already running. [decided in substance]
- When something interrupts a tab the kit opened, the caller (an LLM: the setup step or Bot Father) looks at the tab through Orca and answers in the tab: trust is given by clicking yes (if the harness then writes its own config, that is fine); a harness's own update offer is accepted; the oh-my-zsh update question gets a no; anything it does not recognise is raised with the user through Bot Father or whoever asked to start the fleet. The kit's code does not change user-level settings on its own initiative. None of this is a ban: the user can ask the LLM to do it another way. [decided]
- Restarts are avoided but not banned. One happens when the user asks for it explicitly. When everything needs restarting, Bot Father reminds the user to do it from the ops session. [decided]
- Changes reach running sessions without a restart wherever the harness allows it; the sessions a change affects are told. [decided]
- A config change notifies the sessions it affects. [decided — blanket]

### 6.6 Rules and `AGENTS.md`

- Each bot has one `AGENTS.md`, shared by all its sessions. It is per bot — the bot's identity — not a universal file. [decided]
- It is built from the bot's charter plus rule units: the kit's common rules, the user's rules, and the bot's own choices, with defaults that every bot gets. What the user wrote by hand is kept, and a conflict with the build is shown, never silently overwritten. [decided] → ADR 0003
- `CLAUDE.md` in the bot folder is a symlink to `AGENTS.md`. [decided]
- The kit imports the good rules from the owner's global rules file and carries them itself. It does not rely on any user-level rules file, and it does not depend on the owner's `agent-infra` repo, which goes away in the long run. The owner intends to remove his own user-level rules; to him only repo-level and bot-level rules make sense now. [decided]
- A short set of always-on rules lives in `AGENTS.md`; the depth lives in skills. No separate principles skill. [decided]
- A bot's charter says what it owns, what good looks like, and what it must ask about first. A bot acts alone only inside that written boundary. [decided in principle; charter fields proposed]

### 6.7 Skills management

- The kit ships common skills the user picks from. The user may keep common skills in the bots root or anywhere. [decided]
- `skills.yaml` lists online sources: repo, subfolder, ref (branch, tag or sha). The kit clones them into the sibling `<bots>.skill-sources/` folder, records the resolved sha, and links what a bot uses. [decided]
- A bot can use skills from the kit, from the user's common folder, from an online source, or from any path; they are linked into both harnesses. Anything the user placed by hand is left alone and shown as not managed by the kit. Skills are per bot. [decided]
- A one-line warning when a source has scripts or hooks; no scanning, no gate — the user takes the risk. [decided]
- Kit skill names carry the prefix `obk-`; folder name = skill name. [decided] → ADR 0009
- Bot Father recommends and provides the right skills for each role the user creates. [decided]

### 6.8 Bot Father

- Init creates Bot Father with its default management session on. [decided]
- An extra ops tab in Bot Father's project, **always out of the book**: a plain shell, any harness, for fleet-wide operations. [decided]
- Grooming is a separate, optional session. It is woken daily by an Orca automation. [decided]
- Grooming reads the managed bots' new history, runs finops, and sends its result to the management session, which recommends further. [decided]
- Finops is part of the bot-management skill family and one step of daily grooming. Usage comes from the harness transcripts; prices come from a live lookup on the provider's page; it says so when a price is unknown. It advises on model, effort and context, and flags signs that a model is not smart enough. ccusage and third-party price files are optional, not dependencies. [decided]
- Routing: a kit problem is filed as a GitHub issue directly (no draft step); a usage problem goes back to the managed session as feedback. [decided]
- Management skills: how many and how they split is the builder's choice. [decided]
- Conflict checks — a tool writing into a managed config file, and other configuration conflicts — are part of bot management: a doctor skill, or merged into another management skill. [decided] The kit's code reports facts; judging them and proposing a fix is the skill's job. [decided in substance]
- Ordinary bots do not read other bots' histories unless the user asks. Bot Father and grooming may. [decided]
- Practices borrowed from how people run Grok Bots: an interview that writes the bot's charter; a review of the bot list that gives each bot one verdict; a pattern counts only after it appears twice; each finding gets one kind of fix; short reports; pausing a bot also pauses its automation. [proposed]

### 6.9 Messaging

- Sessions and bots can talk. Same harness: native messaging when it works; across harnesses: Orca. [decided] → ADR 0008
- Research result: Claude-to-Claude native messaging is documented and addressable by session name; Codex-to-Codex (`codex queue`) is not trustworthy yet. So: Claude↔Claude native; everything else through the Orca mailbox; retest Codex during the build. [decided rule, researched outcome]
- A message through Orca goes as plain text up to a size limit; above the limit it must go as a file that the message refers to. One simple rule, no judgement needed. [decided]
- Default behaviour is "good enough": queued, not interrupting; no waiting for an ack; a reply only when asked for; interrupt supported but used with caution; no over-broadcasting. [decided]
- The kit sets no message-acceptance override. With the default `auto` level on both ends, Claude Code delivers native messages without asking; that is the harness's own rule. A pair that includes a `dangerously-skip` session would be held for approval, so such pairs use the Orca mailbox. [decided: it is up to auto mode]

### 6.10 Git behaviour of the bots repo

- Config, rules, prompts, grooming findings and `sessions.yaml` are committed. The CLI never commits by itself; Bot Father commits after a management action; grooming commits once a day. [decided]

## 7. Methodology skills

### 7.1 Principles for the skill set

- The skills are candidates for all bots; the user picks them, helped by suggestions. They give techniques only: no process, no phases, no assumed way of working, so the user can apply whatever way of working they like. Lightweight does not mean fluffy: each skill takes a very good portion of the good material from all the sources. [decided]
- Organised by technique, not by role. [decided]
- Written by deep picking and writing from the sources, following the decisions in this PRD; not a summary, and the porting must be of good quality. Each skill gets a couple of different reviews, and the final review rounds include an architecture review in addition to the normal reviewers. [decided]
- The harnesses' built-in skills are just one more source. Whatever is taken from any source must match our philosophy and not conflict with it. [decided]
- No licence problems: only sources whose licence allows reuse, with credit. [decided]
- Plain, neutral tone; no personal colour and no "only I know" voice. [decided]
- The user is free in how they handle PRDs, trackers and work tracking. Skills neither require nor prescribe one. [decided]
- What the kit owns must be maintainable in principle. An existing tool the kit relies on must be standard and famous. [decided] → ADR 0006
- Sources: mattpocock/skills (mostly aligned; tracker, PRD and workflow parts left out), Cursor pstack (cherry-pick; mode, personas, multi-model machinery, PR automation and the principle set left out), superpowers (cherry-pick concrete checks only), Kent Beck (take what is good), Karpathy-style rules, citypaul's mutation skill, Cloudflare's security-audit skill (ideas for review; recommended as an upstream source, not bundled), Claude Code's built-in review skills (ideas for review). [decided: mattpocock mostly aligned, pstack cherry-pick, Kent Beck take what is good. proposed: the superpowers, Karpathy-style, citypaul and Cloudflare uses, and every pick list]

### 7.2 Skills

| Skill | What it covers | Status |
|---|---|---|
| `obk-tdd` | Test first, one vertical slice at a time; tests through the public interface; how to write good tests and the shapes of bad ones; separate test author; mutation testing; bug tests | [decided: exists, test first in vertical slices, separate author, mutation; the rest of the content proposed] |
| `obk-debugging` | Reproduce; find the difference (environment, version, context); failing command before theory; random bugs and slow code | [direction agreed] |
| `obk-arch` | A very light note of what is wanted; shape (data first, candidates); making the app runnable and testable with a big test step; dividing the work into slices | [decided: the light note, runnable and testable, dividing the work; shape content proposed] |
| `obk-reviewing` | Separate reviewer who only comments; does it follow the repo's rules / does it do what was asked; test checks; filtering; receiving a review | [decided: one review skill, reviewer separate and never edits; content list proposed] |
| `obk-grilling` | Grilling with docs, shipped with the kit | [decided] As one self-contained skill that also sharpens terms and records the glossary and decisions; the name. [proposed] |
| `obk-handoff`, `obk-recall`, `obk-why`, `obk-teach` | Utilities; run on purpose, never automatically; own generic versions | [decided] |
| `obk-personal-facilitation` | Very light to-do and daily help | [decided] |
| the management skills | see 6.8 | [decided] |

### 7.3 Decided rules inside the skills

TDD and tests:

- Test first, one vertical slice at a time. Red/green is for new behaviour. [decided]
- The test author is always separate from the implementer. A subagent counts; or another session, by the user's flavour. [decided] → ADR 0007
- The author gets the requirement and the public interfaces, not the implementer's code plan, and follows the test-writing part of the skill. [decided]
- The implementer cannot change a test to make it pass. [decided] A test that looks wrong is reported to the author. [proposed]
- The author's tests are validated by mutation testing, so silly tests are caught. [decided]
- Mutation check, the rule [decided]:
  1. When: once per piece of work, after the tests are green and before calling it done. Not after every change or fix; again only if a late change rewrote a large part.
  2. What: only the code this work changed, never the whole project.
  3. Skip it, and say so, for docs or config only, renames and wording, throwaway prototypes, and code with no runnable tests.
  4. Proportion: no routine long testing for something minor, and never again and again for the same PR. The effort fits the size and risk of the change; when a run would be long, narrow it (changed files, the risky logic, or a sample) and say so. There is no fixed time number.
  5. Purpose: would the tests catch a real mistake? There is no score to reach.
  6. Survivors: fix one only if it shows a gap in behaviour the requirement cares about. Ignore message wording, logging and no-visible-difference cases. List the rest in two or three lines; do not analyse every one.
  7. Who: the implementer runs it; a test that needs strengthening goes to the separate test author.
  8. Tool: the language's standard tool; if it is not set up, guide the user to set it up and follow their choice; failing that, the agent does it by hand with five to eight small deliberate breaks, chosen before looking at the tests, each reverted with git.
  9. Report: three lines: what it ran on, killed and survived, what was done about the survivors.
- Refactoring is outside the red/green loop. A small refactor is part of the change and fits the same old contract (so the existing tests stay green — the assistant's reading). If a change is so substantial that the old tests cannot hold, the tests are redone the proper way: the separate author again, usually deleting the old tests first. A large-scale refactor is a planned activity of its own. [decided]

Review:

- The reviewer is always separate (a subagent counts) and never modifies code; it only comments. The implementer makes the change, and the change is verified again. [decided] → ADR 0007

Architecture:

- An agent being able to check its own work is reached through TDD at the small scale and, at the large scale, through an architecture that makes the app runnable and testable. No separate verification-harness skill. [decided]
- A very light part on stating what is wanted and dividing the work; the user decides the details and the tracking system. [decided]
- When the whole app is designed, or a new feature is planned, the large test work that tests it end to end is planned with it. [decided]

General:

- Less is better where possible. [decided]
- No guard script. [decided]

## 8. Working agreement for building this

This section is how this repo is being built right now. It is a temporary arrangement and is not part of the kit: the kit's skills must not assume it (no fixed reviewer session, no fixed developer tab, no one-issue-then-clear routine).

- A minimal PRD way of working, a light version until the new AssuredLoop is ready: this PRD, the ADRs we decided, then issues that reference the PRD (they do not copy it), cleaning out the old issues as we go. A developer works the issues one by one. [decided]
- "merge to main is ok" — the owner's words on how the PRD and ADRs land. [decided]
- Issues are vertical slices, each with a check; the first one makes the CLI runnable and testable end to end. [proposed]
- Old issues #9–#19 are closed as superseded once this PRD is on `main`. [decided]
- For now: one developer session (Claude, Opus 5, high effort) works one issue at a time. A separate reviewer session (Codex, Astra, high effort) in its own clone reviews each PR once and only comments. The developer fixes what the review asked and then merges the PR itself; it does not wait for the owner. A second review happens only when the case is out of the ordinary. The design session stays outside as coordinator: it hands out the issues, routes the review, clears the developer session between issues, decides most questions and takes only real owner decisions to the owner. [decided, temporary]
- CI runs a good current Node version, not the lowest one the package supports. [decided]
- A symlink loop in a path the kit is given is detected and reported to the user as a problem, in plain words. [decided]
- Issues and briefs give intent and boundary, never how. Builders take the boring way: what a standard library or the platform already does is used, not hand-rolled, and no requirement is made stricter than the intent needs. Reviewers question the approach before the edge cases. [decided]
- Thorough is good, formality for its own sake is not. Reviews and mutation checks go deep on what can break and on whether the change does what was asked; they do not repeat the same formal checks on every PR, and a second or third look skips what did not change, on judgment. [decided, temporary]
- Each build step ends with a live check in Orca on both harnesses where it applies. [proposed]
- Live checks still owed from research: the session id follows `/clear`; a Claude session name survives resume; Codex auto mode allows `orca` and `gh`; the Orca automation keeps one grooming conversation; `codex queue` retest.
