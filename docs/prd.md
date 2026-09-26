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

1. After installing the kit and `obk init`, an Orca project "Bot Father" exists with a daily session tab and an ops tab; the bots folder is a git repo and contains no kit code.
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
- No "main brain" dispatcher role for now; later it may be an optional recipe built from the existing skills. A third harness is not added now, but adding one must stay cheap. [decided]
- No cloud execution. [proposed — carried from Request #9]

## 6. Product

### 6.1 Shape

- An npm package with a CLI and skills, installed with `npm install -g @assuredloop/orca-bot-kit`. Working on the kit itself runs a clone's `src/cli.js` by its full path: the `obk` on PATH stays the published install, and the kit calls itself back by the path of the CLI that started it (#220). [decided]
- Everything, skills included, comes from the package. [decided]
- The user manages bots, skills and prompts through an LLM — normally Bot Father's management session, whose skills call the CLI. [decided]
- The harnesses are assumed to be installed and configured. [decided]
- The repo is `orca-bot-kit`. [decided] The npm package is `@assuredloop/orca-bot-kit` and the command is `obk`. It is published from CI when a GitHub Release is published by hand, through npm's trusted publishing, with no stored token. [decided by the owner, 2026-09-24]

### 6.2 Host

- Orca. A bot is an Orca project; a session is a tab. Naming, ordering, phone and remote access are Orca's. [decided] → ADR 0024
- A bot's Orca project is a folder workspace; many tabs share it. Proven live: a git-kind registration of a folder inside the bots repo gets no worktree and cannot host tabs. So a bot's project shows no git status in Orca. [decided by the coordinator on evidence]
- Everything is in the book except one special tab. A session's Orca tab id and the bot's Orca project id live in the book with the session. The only exception is Bot Father's ops tab for whole-fleet maintenance. The kit does not track it at all: no id, no title matching, no session id, no history, not seen by grooming. The kit only makes sure it exists: if Bot Father's Orca project has no tab besides the ones in the book, `obk up` creates one (and sets its title). Nothing more. [decided]
- The kit always tries to set a tab's title to the name in the book, and never reads or relies on what a tab is currently called; the tab id is the key. [decided] (Observed: titles can change even with Orca's dynamic title option off, because the program in the tab writes its own title.)
- A bot home is a plain folder. The kit never creates a git worktree for the bots repo or for a bot, and never registers a bot folder in Orca as a git repo. Orca calls every workspace a "worktree"; the kit's output and docs say "Orca project" or "folder workspace". [decided]
- `obk init` takes `--harness claude|codex` with no silent default and no interactive prompt; the setup step asks the user once and passes it. [decided by the coordinator]

### 6.3 Workspace

- All bots live in one folder, and that folder is one git repo for all bots. It is local; the user may push it. [decided]
- The kit does not copy its code or skills into it unless the user wants that; kit skills are links to the installed package. [decided] → ADR 0014
- Inside that repo: what every bot gets by default, the user's own rules and common skills, the list of online skill sources, and one folder per bot holding its charter and settings, its book of sessions, its `AGENTS.md`, its skills, its shared notes and its work area. Clones of online skill sources sit beside the bots repo, never inside it. File and folder names are the builder's choice. [decided in substance]
- `work/` is gitignored. [decided — blanket]
- ~~Per-bot `memory/`: plain notes all sessions of the bot can read and write.~~ Removed by the owner on 2026-09-23 (#171): never built, and the profile notes, the grooming findings and the book cover what it was for. It comes back only if someone misses it.

- Writing is not banned anywhere: an AI acting on the user's instruction may write whatever the user asks, user-level settings included. What the kit's own mechanical code writes is narrower: it writes the files the kit manages in the bots repo, and it does not reach into the user's global or user-level settings by itself. When that code edits a file that also holds the user's own text, it keeps what the user wrote and leaves a valid file, using the standard library for the format. [decided]
- A symlink loop in a path the kit is given is detected and reported to the user as a problem, in plain words. [decided] (Moved here from section 8 on 2026-09-24.)

### 6.4 Bots and sessions

- Sessions of one bot share the bot home. One bot may have several sessions. [decided]
- Every session starts at the bot home. A per-session work dir is an instruction only and is always a plain folder; the kit creates it and adds the note to the start prompt automatically. It has nothing to do with git worktrees. When a bot clones a repo into its work dir and works on it, it honours that repo's own rules; whether it clones, uses a worktree there, or does something else is for the user to say. [decided]
  Changed by the owner on 2026-09-24 (#241): it honours both that repo's rules and its own. Where they conflict it does not pick one: it raises the conflict with the user or whoever gave the work, names both texts, and holds the conflicting part until it is settled. Fleet review looks for such conflicts; nothing settles them automatically, and neither side's rules are changed without their owner. [decided]
- Each session sets: harness, model, effort, context window, approval level, start prompt. [decided]
- The kit never hardcodes a model id; empty means the harness default. Init asks once for the harness. [decided]
- Approval levels: `auto` (default; the harness's real auto mode), `ask`, `dangerously-skip` (only when the user asks for it in plain words). [decided] → ADR 0015
- Each approval level maps to the harness's own flags; the mapping is a fact kept in `tech-notes.md` and re-checked when a harness updates. A session can carry extra launch arguments the kit does not know about. [decided in substance]
- A start prompt goes to the harness from a file, unless it is very short and simple, in which case it can go as plain text. Either way it arrives as written, apart from two things the kit does on purpose: leading and trailing blank space is trimmed, and when a session has a work dir the kit appends its one-sentence note about it. [decided; the two exceptions settled by the owner on 2026-09-23, #168]
- Start prompt: sent once when the tab is created; not re-sent on resume; **re-sent automatically after `/clear`**. It is the only thing that tells one session's duty from another's when they start in different tabs. [decided]
- Bot creation can resume an external existing session. Setup is done through an LLM, now and later through Bot Father, and that LLM does its best to help the user migrate the rest. [decided]

### 6.5 Session identity

- The kit's book is the authority for session ids. Orca loses its resume record when a tab is closed. [decided] → ADR 0012
- The kit learns a session's new id whenever the session starts, resumes or is cleared, and keeps the old one in that session's history. Whatever it installs for this lives in the bot's own folder, never in user-level settings. [decided] → ADR 0022
- `/clear` and compact are supported. `/clear` always makes the harness generate a new session id (certain for Claude Code, likely the same for Codex). The old ids are kept, for history, auditing, finops or whatever needs them. `/clear` means the user wants a clean start; no handoff happens automatically. [decided]
- Session ids are remembered across a restart, whether from a computer restart or one asked for by Bot Father. [decided]
- When skills change, Bot Father's management skill knows how to reload them without a restart. [decided]
- Bringing the fleet up is safe to repeat: it restores what is missing and never closes or disturbs what is already running. [decided in substance]
- Orca has its own per-agent default launch arguments (its "yolo" setting), and when they carry a permission bypass every session Orca relaunches or resumes runs in that mode, whatever the kit asked for. The kit does not set that Orca setting. It checks it during setup and in its health check, and when it finds a bypass there it reminds the user to change it to something safer, in plain words, every time. [decided]
- When something interrupts a tab the kit opened, the caller (an LLM: the setup step or Bot Father) looks at the tab through Orca and answers in the tab: trust is given by clicking yes (if the harness then writes its own config, that is fine); a harness's own update offer is accepted; the oh-my-zsh update question gets a no; anything it does not recognise is raised with the user through Bot Father or whoever asked to start the fleet. The kit's code does not change user-level settings on its own initiative. None of this is a ban: the user can ask the LLM to do it another way. [decided]
- Restarts are avoided but not banned. One happens when the user asks for it explicitly. When everything needs restarting, Bot Father reminds the user to do it from the ops session. [decided]
- Changes reach running sessions without a restart wherever the harness allows it; the sessions a change affects are told. [decided]
- A config change notifies the sessions it affects. [decided — blanket]

### 6.6 Rules and `AGENTS.md`

- Each bot has one `AGENTS.md`, shared by all its sessions. It is per bot — the bot's identity — not a universal file. [decided]
- It is built from the bot's charter plus rule units: the kit's common rules, the user's rules, and the bot's own choices, with defaults that every bot gets. What the user wrote by hand is kept, and a conflict with the build is shown, never silently overwritten. [decided] → ADR 0013
- `CLAUDE.md` in the bot folder is a symlink to `AGENTS.md`. [decided]
- The kit imports the good rules from the owner's global rules file and carries them itself. It does not rely on any user-level rules file, and it does not depend on the owner's `agent-infra` repo, which goes away in the long run. The owner intends to remove his own user-level rules; to him only repo-level and bot-level rules make sense now. [decided]
- A short set of always-on rules lives in `AGENTS.md`; the depth lives in skills. No separate principles skill. [decided]
- A bot's charter says what it owns, what good looks like, and what it must ask about first. A bot acts alone only inside that written boundary. [decided in principle; charter fields proposed]
- Two plain defaults in the kit's rules: no silent fallback (when the model a session asks for is not available, the bot says so and asks; it never quietly switches), and role limits such as "read-only, does not modify" are a normal part of a charter. [decided]

### 6.7 Skills management

- The kit ships common skills the user picks from. The user may keep common skills in the bots root or anywhere. [decided]
- `skills.yaml` lists online sources: repo, subfolder, ref (branch, tag or sha). The kit clones them into the sibling `<bots>.skill-sources/` folder, records the resolved sha, and links what a bot uses. [decided]
- A bot can use skills from the kit, from the user's common folder, from an online source, or from any path; they are linked into both harnesses. Anything the user placed by hand is left alone and shown as not managed by the kit. Skills are per bot. [decided]
- A one-line warning when a source has scripts or hooks; no scanning, no gate — the user takes the risk. [decided]
- Kit skill names carry the prefix `obk-`; folder name = skill name. [decided] → ADR 0019
- Bot Father recommends and provides the right skills for each role the user creates. [decided]

### 6.8 Bot Father

- Init creates Bot Father with its default management session on. [decided]
- An extra ops tab in Bot Father's project, **always out of the book**: a plain shell, any harness, for fleet-wide operations. [decided]
- Roster cards: every bot has a short card — its name, its harness, model and effort, a two-line charter, and one hard limit (for example "read-only, does not modify"). The charter interview produces it, and Bot Father can show the whole fleet as a list of cards. [decided]
- Team recipes: when the user creates bots, Bot Father suggests a few proven line-ups instead of a blank page, for example a developer pair on different models plus an architect (one implements; the other writes the acceptance tests and reviews; the architect arbitrates and digs into hard root causes), or a workhorse, a writer and a thinker for non-developers. Suggestions only; the user picks and changes. [decided]
  Changed by the owner on 2026-09-24 (#233): in the developer line-up each developer works an issue of its own, and the architect hands out the issues, arbitrates and digs into hard root causes. The tests come from a different author than the code, and the review from a different reviewer. Which kind each is (a fresh subagent, a new session, another bot) is the user's to say: Bot Father asks, or leaves it open, and never fixes one itself, and it points a code-writing bot to the kit's `tests-first` and `review` rule units. [decided] Running the developers on different models stays a suggestion. [the architect's reading, 2026-09-24; the owner may overrule]
- Grooming is a separate, optional session. ~~It is woken daily by an Orca automation.~~ [decided] The automation is replaced by the change below (#223); on Claude Code it was built in #237.
  Changed by the owner on 2026-09-24 (#223): scheduled work, grooming first and any bot's scheduled job later, does not use an Orca automation, because an automation cannot carry a model or an effort of its own. A bot on Claude Code uses Claude Code's own scheduling. A bot on Codex keeps a persistent placeholder session in the book; each scheduled run is a temporary session that does the work and sends its result to that placeholder when done, and the placeholder is where the results are read. The model and effort chosen for the job are the ones the run actually uses. [decided]
  ~~Verified in slice 11: an Orca automation cannot wake a tab the kit made, so the grooming session is the automation's own, a fresh conversation each run,~~ with its memory in files (the profile notes and the open findings) rather than in the book. The schedule is created off and turned on by one explicit yes after the user has read a run, because it spends tokens every day. [decided by the coordinator, 2026-09-21; the owner was told] The struck part is replaced by the change above: on Claude Code the grooming session is a session in the book, and its runs share one long conversation, which the owner accepted on 2026-09-24 (#223: "just do /compact when needed, add to the skill"). The memory in files carries over, and so does the one explicit yes. [#237; the yes carried over is the architect's reading, and the owner may overrule]
- Grooming reads the managed bots' new history, runs finops, and sends its result to the management session, which recommends further. [decided]
- Grooming keeps a few lines of profile notes per bot: what it is good at, where it struggles, what it costs. Any bot that needs help can read them to pick the right collaborator. [decided]
- Finops is part of the bot-management skill family and one step of daily grooming. Usage comes from the harness transcripts; prices come from a live lookup on the provider's page; it says so when a price is unknown. It advises on model, effort and context, and flags signs that a model is not smart enough. ccusage and third-party price files are optional, not dependencies. [decided]
- Routing: a kit problem is filed as a GitHub issue directly (no draft step); a usage problem goes back to the managed session as feedback. [decided]
- Management skills: how many and how they split is the builder's choice. [decided]
- Conflict checks — a tool writing into a managed config file, and other configuration conflicts — are part of bot management: a doctor skill, or merged into another management skill. [decided] The kit's code reports facts; judging them and proposing a fix is the skill's job. [decided in substance]
- Ordinary bots do not read other bots' histories unless the user asks. Bot Father and grooming may. [decided]
- Practices borrowed from how people run Grok Bots: an interview that writes the bot's charter; a review of the bot list that gives each bot one verdict; a pattern counts only after it appears twice; each finding gets one kind of fix; short reports; pausing a bot also pauses its automation. [proposed]

### 6.9 Messaging

- Sessions and bots can talk. Same harness: native messaging when it works; across harnesses: Orca. [decided] → ADR 0018
- Research result: Claude-to-Claude native messaging is documented and addressable by session name; Codex-to-Codex (`codex queue`) is not trustworthy yet. So: Claude↔Claude native; everything else through the Orca mailbox; retest Codex during the build. [decided rule, researched outcome]
- A message through Orca goes as plain text up to a size limit; above the limit it must go as a file that the message refers to. One simple rule, no judgement needed. [decided]
- Default behaviour is "good enough": queued, not interrupting; no waiting for an ack; a reply only when asked for; interrupt supported but used with caution; no over-broadcasting. [decided]
- The kit sets no message-acceptance override. With the default `auto` level on both ends, Claude Code delivers native messages without asking; that is the harness's own rule. A pair that includes a `dangerously-skip` session would be held for approval, so such pairs use the Orca mailbox. [decided: it is up to auto mode]
- A message that the receiving session's approval rule holds or refuses is not re-sent by another route; the sender waits, or the user decides. Choosing Orca for a mixed-approval pair is transport selection made in advance, not a way around a hold that has happened. [decided by the coordinator after a peer audit]

### 6.10 Git behaviour of the bots repo

- Config, rules, prompts, grooming findings and `sessions.yaml` are committed. The CLI never commits by itself; Bot Father commits after a management action; grooming commits once a day. [decided]
  Changed by the owner on 2026-09-24 (#235): every bot commits its own changes to the bots repo often, staging by name only what it changed. It is a rule every bot carries, not left to Bot Father or grooming. The CLI still never commits by itself. Pushing is not part of this decision. [decided] A bot commits what it changed, and what the kit wrote in its own bot's folder (its files there and its book of sessions); Bot Father commits what no bot owns: init's files, the defaults, the user's rules and skill lists. [the architect's reading, 2026-09-25; the owner may overrule]

## 7. Methodology skills

### 7.1 Principles for the skill set

- The skills are candidates for all bots; the user picks them, helped by suggestions. They give techniques only: no process, no phases, no assumed way of working, so the user can apply whatever way of working they like. Lightweight does not mean fluffy: each skill takes a very good portion of the good material from all the sources. [decided]
- Organised by technique, not by role. [decided]
- Written by deep picking and writing from the sources, following the decisions in this PRD; not a summary, and the porting must be of good quality. Each skill gets a couple of different reviews (at least fit with the PRD and lost substance against the sources); the architect steps in only when a case is out of the ordinary. [decided]
- The harnesses' built-in skills are just one more source. Whatever is taken from any source must match our philosophy and not conflict with it. [decided]
- No licence problems: only sources whose licence allows reuse, with credit. [decided]
- The shelf is for all bots, not only developers. After the development techniques come three light ones for other roles: researching (sources, how each claim is supported, fact apart from inference), writing (audience, platform, tone, key facts checked), and a decision memo (conclusion, evidence, alternatives, risks, counter-examples, uncertainty). Same standard: techniques only, deeply written. [decided]
- Plain, neutral tone; no personal colour and no "only I know" voice. [decided]
- The user is free in how they handle PRDs, trackers and work tracking. Skills neither require nor prescribe one. [decided]
- What the kit owns must be maintainable in principle. An existing tool the kit relies on must be standard and famous. [decided] → ADR 0016
- Sources: mattpocock/skills (mostly aligned; tracker, PRD and workflow parts left out), Cursor pstack (cherry-pick; mode, personas, multi-model machinery, PR automation and the principle set left out), superpowers (cherry-pick concrete checks only), Kent Beck (take what is good), Karpathy-style rules, citypaul's mutation skill, Cloudflare's security-audit skill (ideas for review; recommended as an upstream source, not bundled), Claude Code's built-in review skills (ideas for review). [decided: mattpocock mostly aligned, pstack cherry-pick, Kent Beck take what is good. proposed: the superpowers, Karpathy-style, citypaul and Cloudflare uses, and every pick list]

### 7.2 Skills

| Skill | What it covers | Status |
|---|---|---|
| `obk-tdd` | Test first, one vertical slice at a time; tests through the public interface; how to write good tests and the shapes of bad ones; separate test author; mutation testing; bug tests | [decided: exists, test first in vertical slices, separate author, mutation; the rest of the content proposed] |
| `obk-debugging` | Reproduce; find the difference (environment, version, context); failing command before theory; random bugs and slow code | [direction agreed] |
| `obk-arch` | A very light note of what is wanted; shape (data first, candidates); making the app runnable and testable with a big test step; dividing the work into slices | [decided: the light note, runnable and testable, dividing the work; the note's five items (the problem, who it is for, what the user can do, how we know, what we are not doing) proposed and never answered; shape content proposed] |
| `obk-reviewing` | Separate reviewer who only comments; does it follow the repo's rules / does it do what was asked; test checks; filtering; receiving a review | [decided: one review skill, reviewer separate and never edits; content list proposed] |
| `obk-grilling` | Grilling with docs, shipped with the kit | [decided] As one self-contained skill that also sharpens terms and records the glossary and decisions; the name. [proposed] |
| `obk-handoff`, `obk-recall`, `obk-why`, `obk-teach` | Utilities; run on purpose, never automatically; own generic versions | [decided] |
| `obk-personal-facilitation` | Very light to-do and daily help | [decided] |
| the management skills | see 6.8 | [decided] |

### 7.3 Decided rules inside the skills

TDD and tests:

- Test first, one vertical slice at a time. Red/green is for new behaviour. [decided]
- The test author is always separate from the implementer. A subagent counts; or another session, by the user's flavour. [decided] → ADR 0017
- The author gets the requirement and the public interfaces, not the implementer's code plan, and follows the test-writing part of the skill. [decided]
- The implementer cannot change a test to make it pass. [decided] A test that looks wrong is reported to the author. [decided: AGENTS.md, the owner's decisions on how code is made, #108]
- The author's tests are checked by the mutation check below, so silly tests are caught. [decided]
- Mutation check, the rule [decided]. It is how this repo works and what the kit's TDD skill teaches every developer bot:
  1. Everyday work: the agent's own hand check, once per issue, at the end, only where it earns its place. A small representative set of distinct, plausible mistakes in the risky logic the issue changed, chosen before looking at the tests, each run, expected to fail, reverted; it stops when another break would add no evidence, says why the set was enough, and is reported in three lines. Skipped, and said so, for slices with no real logic (docs, wiring, renames, prototypes); size and file type do not decide whether logic is risky. Code with no runnable tests is not skipped as logic-free: the report names the missing coverage, the reason, the stand-in check and what stays uncertain.
  2. Audit: a mutation tool over the whole suite is an occasional audit, at a milestone or when the user asks, in its own tab in the background at a quiet time. Read once; the real gaps become a handful of test issues; the rest is ignored. Never per PR, never repeated for the same PR.
  3. Exception: for a piece of work at the core of the product, one narrowed tool run on the changed logic, in the background, about twenty minutes; if it does not fit, the hand check. Then no more.
  4. Purpose: would the tests catch a real mistake? There is no score to reach. Fix a survivor only if it shows a gap in behaviour the requirement cares about; ignore message wording, logging and no-visible-difference cases; list the rest in two or three lines.
  5. Who: the implementer runs the check; a test that needs strengthening goes to the separate test author.
  6. Proportion: no routine long testing for something minor, never again and again for the same PR; a run heading towards hours is stopped. The mutation check is the third safety net after the separate test author (tests first, red before the code) and the reviewer's look at the tests; it stays the cheapest of the three.
  7. For the toolkit user: the TDD skill teaches the hand check as the everyday way and mentions the tool only as an audit; it never makes a tool a requirement, and it does not spend the user's time on a tool that does not fit their suite.
- Refactoring is outside the red/green loop. A small refactor is part of the change and fits the same old contract (so the existing tests stay green — the assistant's reading). If a change is so substantial that the old tests cannot hold, the tests are redone the proper way: the separate author again, usually deleting the old tests first. A large-scale refactor is a planned activity of its own. [decided]

Review:

- The reviewer is always separate (a subagent counts) and never modifies code; it only comments. The implementer makes the change, and the change is verified again. [decided] → ADR 0017

Architecture:

- An agent being able to check its own work is reached through TDD at the small scale and, at the large scale, through an architecture that makes the app runnable and testable. No separate verification-harness skill. [decided]
- A very light part on stating what is wanted and dividing the work; the user decides the details and the tracking system. [decided]
- When the whole app is designed, or a new feature is planned, the large test work that tests it end to end is planned with it. [decided]

General:

- Less is better where possible. [decided]
- No guard script. [decided]

## 8. Working agreement for building this

How this repo is built is not part of the kit, and the kit's skills must not assume it. The repo's own conventions are in `AGENTS.md`. The way the owner's bots build it (who hands out issues, who writes tests and reviews, when a session is cleared) belongs to those bots: it is in the kit-dev bot's charter and prompts. [decided by the owner, 2026-09-24] The earlier text of this section, with its record of the live checks, is in git history; the live checks still owed are in `tech-notes.md` section 5.
