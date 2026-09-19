# Bot Kit on Orca — design PRD

Date: 2026-09-19. Status: draft for owner review.

This PRD replaces the Codex-desktop plan (Request #9, Epic #11 and its children).
The old repository content is read only to understand intent.
Decisions with lasting consequences are in [`docs/adr/`](adr/).

Every item is marked:

- **[decided]** — the owner said so in the design session.
- **[decided — blanket]** — covered by a blanket acceptance ("the round 1 you are right", "THE REST IS OK"), not by a specific statement.
- **[proposed]** — the assistant's proposal; the owner has not confirmed it. Strike or change freely.

Sections 3 and 4 describe the outcome; the tags in sections 5 to 8 govern what is decided.

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
5. After closing a tab (or a reboot), `obk up` brings the session back with its conversation.
6. A skill added or changed through the kit is usable in a running session without a restart.
7. A skill from an online repo is cloned outside the bots repo at the pinned ref and linked into the bot, for both harnesses.
8. A bot's `AGENTS.md` is rebuilt from kit rules + user rules + bot overrides; text outside the managed region survives; a hand edit inside it stops the build.
9. A Claude session and a Codex session exchange a message and a reply; a busy receiver is not interrupted.
10. A grooming run produces a short report in Bot Father's daily session that names at least: one usage figure per session, and any sign of a bot in trouble that it found.
11. A developer bot using the TDD skill produces: a failing test first, a test written by a separate author, and a mutation result.
12. `obk doctor` reports a `CLAUDE.md` above a bot folder, a broken skill link, and a session in the book with no tab.

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
- A bot's Orca project is a plain folder workspace; many tabs share it. [proposed — verified possible]

### 6.3 Workspace

- All bots live in one folder. It is a local git repo; the user may push it. [decided]
- The kit does not copy its code or skills into it unless the user wants that; kit skills are links to the installed package. [decided] → ADR 0004
- Layout [proposed]:

```
<parent>/
  <bots>/                      # the user's local git repo
    defaults.yaml              # rules every bot gets
    skills.yaml                # online skill sources
    rules/                     # the user's own rule units
    skills/                    # the user's own common skills
    bots/<bot>/
      bot.yaml                 # charter, rules, skills, sessions
      sessions.yaml            # live session ids and their history
      AGENTS.md                # compiled; CLAUDE.md is a symlink to it
      .claude/skills/  .agents/skills/
      .claude/settings.json    # kit hook lives here, not in user settings
      memory/                  # plain notes shared by the bot's sessions
      work/                    # target clones; gitignored
  <bots>.skill-sources/        # kit-managed clones of online sources
```

- `work/` is gitignored. [decided — blanket]
- Per-bot `memory/`: plain notes all sessions of the bot can read and write; "remember this" writes there; writing does not message other sessions. [decided]

### 6.4 Bots and sessions

- Sessions of one bot share the bot home. One bot may have several sessions. [decided]
- Every session starts at the bot home. A per-session work dir is an instruction only; the kit creates the folder and adds the note to the start prompt automatically. Git worktrees are optional, not default. [decided]
- Each session sets: harness, model, effort, context window, approval level, start prompt. [decided]
- The kit never hardcodes a model id; empty means the harness default. Init asks once for the harness. [decided]
- Approval levels: `auto` (default; the harness's real auto mode), `ask`, `dangerously-skip` (only when the user asks for it in plain words). [decided] → ADR 0005
- Flag mapping, checked on Claude Code 2.1.278 and Codex 0.153.4 [proposed]: `auto` = `--permission-mode auto` / `--approve-for-me`; `ask` = `--permission-mode manual` / `-a on-request`; `dangerously-skip` = `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox`. Codex gets `--add-dir` for a work dir outside the bot home. Free `extra_args` per session.
- Start prompt: sent once when the tab is created; not re-sent on resume; **re-sent automatically after `/clear`**. It is the only thing that tells one session's duty from another's when they start in different tabs. [decided]
- Bot creation can resume an external existing session; the rest of a migration is best effort by the LLM. [decided]

### 6.5 Session identity

- The kit's book is the authority for session ids. Orca loses its resume record when a tab is closed. [decided] → ADR 0002
- A hook in the bot's own settings fires on start, resume and clear, and calls `obk session-seen`, which writes the new id and moves the old one to history. Codex: its own hooks file; fallback = newest transcript for that bot folder. [decided] → ADR 0010
- `/clear` and compact are supported. `/clear` means the user wants a clean start; no handoff happens automatically. [decided]
- Session ids are remembered across a restart, whether from a computer restart or one asked for by Bot Father. [decided]
- When skills change, Bot Father's management skill knows how to reload them without a restart. [decided]
- `obk up` is idempotent: for each session in the book with no tab, create the tab with the resume id. It never closes tabs. [proposed]
- Restart is a last resort: Bot Father warns, says why, and gets permission first. [decided]
- Reload without restart: skill changes are picked up live and the session gets a short note; a rule change gets a "re-read your AGENTS.md" message; model and effort are switched in-session where the harness allows. [proposed]
- A config change notifies the sessions it affects. [decided — blanket]

### 6.6 Rules and `AGENTS.md`

- Each bot has one `AGENTS.md`, shared by all its sessions. It is per bot — the bot's identity — not a universal file. [decided]
- It is compiled from rule units: kit common rules + the user's rules + per-bot overrides, plus the bot's charter. `defaults.yaml` sets what every bot gets. Text outside the managed region is kept; a hand edit inside it stops the build and shows the conflict. [decided] → ADR 0003
- `CLAUDE.md` in the bot folder is a symlink to `AGENTS.md`. [decided]
- The kit imports the good rules from the owner's global rules file and carries them itself. It does not rely on any user-level rules file, and it does not depend on the owner's `agent-infra` repo, which goes away in the long run. The owner intends to remove his own user-level rules; to him only repo-level and bot-level rules make sense now. [decided]
- A short set of always-on rules lives in `AGENTS.md`; the depth lives in skills. No separate principles skill. [decided]
- A bot's charter says what it owns, what good looks like, and what it must ask about first. A bot acts alone only inside that written boundary. [decided in principle; charter fields proposed]

### 6.7 Skills management

- The kit ships common skills the user picks from. The user may keep common skills in the bots root or anywhere. [decided]
- `skills.yaml` lists online sources: repo, subfolder, ref (branch, tag or sha). The kit clones them into the sibling `<bots>.skill-sources/` folder, records the resolved sha, and links what a bot uses. [decided]
- A bot references skills as `kit:`, `common:`, `src:` or `path:`; `skills sync` makes the links into both harness folders. Anything placed by hand is left alone and listed as unmanaged. Skills are per bot. [decided]
- A one-line warning when a source has scripts or hooks; no scanning, no gate — the user takes the risk. [decided]
- Kit skill names carry the prefix `bk-`; folder name = skill name. [decided] → ADR 0009
- Bot Father recommends and provides the right skills for each role the user creates. [decided]

### 6.8 Bot Father

- Init creates Bot Father with its default management session on. [decided]
- An extra ops tab in Bot Father's project, **always out of the book**: a plain shell, any harness, for fleet-wide operations. [decided]
- Grooming is a separate, optional session. It is woken daily by an Orca automation. [decided]
- Grooming reads the managed bots' new history, runs finops, and sends its result to the management session, which recommends further. [decided]
- Finops is part of the bot-management skill family and one step of daily grooming. Usage comes from the harness transcripts; prices come from a live lookup on the provider's page; it says so when a price is unknown. It advises on model, effort and context, and flags signs that a model is not smart enough. ccusage and third-party price files are optional, not dependencies. [decided]
- Routing: a kit problem is filed as a GitHub issue directly (no draft step); a usage problem goes back to the managed session as feedback. [decided]
- Management skills: how many and how they split is the implementer's choice. [decided] Proposal: `bk-bot-management`, `bk-bot-grooming`, `bk-bot-finops`, `bk-bot-messaging`, `bk-skill-management`. [proposed]
- Conflict checks — a tool writing into a managed config file, and other configuration conflicts — are part of bot management: a doctor skill, or merged into another management skill. [decided] A `obk doctor` command reports plain facts (a `CLAUDE.md` above a bot, broken links, a book session with no tab) and the skill judges them and proposes a fix. [proposed]
- Ordinary bots do not read other bots' histories unless the user asks. Bot Father and grooming may. [decided]
- Practices borrowed from how people run Grok Bots: an interview that writes the bot's charter; a review of the bot list that gives each bot one verdict; a pattern counts only after it appears twice; each finding gets one kind of fix; short reports; pausing a bot also pauses its automation. [proposed]

### 6.9 Messaging

- Sessions and bots can talk. Same harness: native messaging when it works; across harnesses: Orca. [decided] → ADR 0008
- Research result: Claude-to-Claude native messaging is documented and addressable by session name; Codex-to-Codex (`codex queue`) is not trustworthy yet. So: Claude↔Claude native; everything else through the Orca mailbox; retest Codex during the build. [decided rule, researched outcome]
- Default behaviour is "good enough": queued, not interrupting; no waiting for an ack; a reply only when asked for; interrupt supported but used with caution; no over-broadcasting. [decided]
- The kit sets no message-acceptance override. With the default `auto` level on both ends, Claude Code delivers native messages without asking; that is the harness's own rule. A pair that includes a `dangerously-skip` session would be held for approval, so such pairs use the Orca mailbox. [decided: it is up to auto mode]

### 6.10 Git behaviour of the bots repo

- Config, rules, prompts, grooming findings and `sessions.yaml` are committed. The CLI never commits by itself; Bot Father commits after a management action; grooming commits once a day. [decided]

## 7. Methodology skills

### 7.1 Principles for the skill set

- Lightweight. Techniques a bot picks up when needed. No process, no phases. For all bots, not tied to one kind of development. [decided]
- Organised by technique, not by role. [decided]
- Written by deep aggregation: take the good parts of the good sources and pick the best; not a summary. [decided] A separate agent compares each finished skill with the sources for lost substance. [proposed]
- The harnesses' built-in skills are one more source. Anything taken from them must match our philosophy and not conflict with it; it is used to complement what we have written and learned from the other sources. [decided]
- No licence problems: only sources whose licence allows reuse, with credit. [decided]
- Plain, neutral tone; no personal colour and no "only I know" voice. [decided]
- The user is free in how they handle PRDs, trackers and work tracking. Skills neither require nor prescribe one. [decided]
- What the kit owns must be maintainable in principle. An existing tool the kit relies on must be standard and famous. [decided] → ADR 0006
- Sources: mattpocock/skills (mostly aligned; tracker, PRD and workflow parts left out), Cursor pstack (cherry-pick; mode, personas, multi-model machinery, PR automation and the principle set left out), superpowers (cherry-pick concrete checks only), Kent Beck (take what is good), Karpathy-style rules, citypaul's mutation skill, Cloudflare's security-audit skill (ideas for review; recommended as an upstream source, not bundled), Claude Code's built-in review skills (ideas for review). [decided: mattpocock mostly aligned, pstack cherry-pick, Kent Beck take what is good. proposed: the superpowers, Karpathy-style, citypaul and Cloudflare uses, and every pick list]

### 7.2 Skills

| Skill | What it covers | Status |
|---|---|---|
| `bk-tdd` | Test first, one vertical slice at a time; tests through the public interface; how to write good tests and the shapes of bad ones; separate test author; mutation testing; bug tests | [decided: exists, test first in vertical slices, separate author, mutation; the rest of the content proposed] |
| `bk-debugging` | Reproduce; find the difference (environment, version, context); failing command before theory; random bugs and slow code | [direction agreed] |
| `bk-arch` | A very light note of what is wanted; shape (data first, candidates); making the app runnable and testable with a big test step; dividing the work into slices | [decided: the light note, runnable and testable, dividing the work; shape content proposed] |
| `bk-reviewing` | Separate reviewer who only comments; does it follow the repo's rules / does it do what was asked; test checks; filtering; receiving a review | [decided: one review skill, reviewer separate and never edits; content list proposed] |
| `bk-grilling` | Grilling with docs, shipped with the kit | [decided] As one self-contained skill that also sharpens terms and records the glossary and decisions; the name. [proposed] |
| `bk-handoff`, `bk-recall`, `bk-why`, `bk-teach` | Utilities; run on purpose, never automatically; own generic versions | [decided] |
| `bk-personal-facilitation` | Very light to-do and daily help | [decided] |
| the management skills | see 6.8 | [decided] |

### 7.3 Decided rules inside the skills

TDD and tests:

- Test first, one vertical slice at a time. Red/green is for new behaviour. [decided]
- The test author is always separate from the implementer. A subagent counts; or another session, by the user's flavour. [decided] → ADR 0007
- The author gets the requirement and the public interfaces, not the implementer's code plan, and follows the test-writing part of the skill. [decided]
- The implementer cannot change a test to make it pass. [decided] A test that looks wrong is reported to the author. [proposed]
- The author's tests are validated by mutation testing, so silly tests are caught. [decided]
- Mutation testing: use the language's standard tool; if it is not set up, guide the user to set it up and follow their choice; in the worst case the agent does it itself. [decided]
- Refactoring is outside the red/green loop. It is part of a change but fits the same old contract (so the existing tests stay green — the assistant's reading). If a change is so substantial that the old tests cannot hold, the tests are redone the proper way: the separate author again, usually deleting the old tests first. A large-scale refactor is a planned activity of its own. [decided]

Review:

- The reviewer is always separate (a subagent counts) and never modifies code; it only comments. The implementer makes the change, and the change is verified again. [decided] → ADR 0007

Architecture:

- An agent being able to check its own work is reached through TDD at the small scale and, at the large scale, through an architecture that makes the app runnable and testable. No separate verification-harness skill. [decided]
- A very light part on stating what is wanted and dividing the work; the user decides the details and the tracking system. [decided]

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
- Each build step ends with a live check in Orca on both harnesses where it applies. [proposed]
- Live checks still owed from research: the session id follows `/clear`; a Claude session name survives resume; Codex auto mode allows `orca` and `gh`; the Orca automation keeps one grooming conversation; `codex queue` retest.
