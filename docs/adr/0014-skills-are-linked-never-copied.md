# ADR 0014: Skills are linked, never copied; online sources are cloned beside the bots repo

Date: 2026-09-24.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19, except the sentence marked as the developer's for #136. Consulted: the coordinator, who read the owner's layout and proposed recording the sha and the warning.
Supersedes: [ADR 0004](0004-skills-are-linked-never-copied.md).

## Context

The bots folder is the user's own git repo. The kit is installed with npm and
will be updated. Users also want skills from their own folders, from online
repos at a chosen version, or from anywhere on disk. The owner set the shape in
his first requirements: nothing from the kit is copied into the bots repo
unless the user wants it, kit skills "could be a link to the bot kit installaed
skills", online skills are cloned outside the repo and linked in, and "we take
the risk" for what those skills contain (the owner's design session,
2026-09-19, not in the repo).

Both harnesses follow a symlinked skill folder (from their documentation,
2026-09-19). Claude Code needs the skill directory to exist when a session
starts, so every bot has both directories from the start (seen live on Claude
Code 2.1.280 and Codex 0.155.1, 2026-09-22, #157). A link to a kit skill is
absolute, because the skill lives in the installed package outside the user's
repo, so the link holds a path that belongs to one machine.

## Decision

Kit skills are symlinked from the installed package into each bot's
`.claude/skills` and `.agents/skills`. Online sources (repo, subfolder, ref)
are cloned into a folder beside the bots repo, never inside it, with the
resolved sha recorded. Skills placed by hand are left alone. The kit copies a
skill into the bots repo only when the user asks.

The links themselves are part of what the kit makes on a machine rather than
part of the repo, so `init` seeds a `.gitignore` that keeps them and the kit's
record of them out of git; a clone gets its links from `obk up`, and carries
none that point nowhere. (Decided in issue #136 by the developer, inside that
issue's boundary; the owner may overrule.)

## Alternatives considered

- **Copy the skills into the bots repo.** Ruled out by the owner as the
  default: the kit copies nothing in "unless user wants to". Copying stays
  available when the user asks.
- **Clone online sources inside the bots repo.** Not chosen: the coordinator
  read the owner's "in the user bots root parent" as a sibling folder "so
  clones never pollute it", and the owner accepted that round as a block.
- **Keep committing the links, and let the health check report the dangling
  ones on a fresh clone** (#135). Set aside, because a clone arrived with links
  to nothing before `obk up` could put them right, and two machines took turns
  rewriting each other's links (#136).
- **A health line saying a dangling link on a fresh clone is expected** (#135).
  Not chosen: deciding when a broken link is fine is judgement in the kit's
  code, which [ADR 0016](0016-no-kit-owned-expert-systems.md) sends to the
  skills.
- **A `.gitignore` in each bot folder in place of one at the root** (#142).
  Not chosen: it would have needed a way to merge the kit's lines into a file
  the user also writes in, at three places, for no extra coverage, and Bot
  Father had no `.gitignore` at all.
- **Ignore the skill directories rather than the entries in them** (#142). Not
  chosen: git cannot take a file back into a directory it has been told to
  ignore, and what the user keeps in there beside the kit's links is theirs.
- **Untrack links a repo has already committed** (#142). Not done by the kit:
  staging that deletion is the user's, not the CLI's (PRD 6.10).
- Git submodules and relative links: not recorded as considered.

## Consequences

- Good: updating the kit updates every bot's kit skills at once.
- Good: the bots repo stays small and holds only the user's own content.
- Bad: links break if the package moves; the kit's health check reports broken
  links.
- Bad: the user takes the risk for third-party skills; the kit only prints a
  one-line warning when a source has scripts or hooks.
- Bad: git ignores nothing it already tracks, so a repo that committed its
  links before #136 keeps them until the user removes them.
- Revisit if: a harness stops following symlinked skill folders, or the kit is
  shipped some other way than as an installed package. Confidence: high; both
  harnesses load linked skills today. (Proposed in #262; not recorded when it
  was decided.)
- Checked by: `test/skills-build.test.js`,
  `test/clone-carries-no-kit-links.test.js` and the health check's report of
  broken links.

## History

- 2026-09-19, [ADR 0004](0004-skills-are-linked-never-copied.md): decided by
  the owner in his design session. It named the sibling folder
  `<bots>.skill-sources/` and the `doctor` command.
- 2026-09-20, [ADR 0004](0004-skills-are-linked-never-copied.md): wording
  only. The folder became "a folder beside the bots repo, never inside it", and
  `doctor` became "the kit's health check", when the owner asked for decisions
  without mechanism names (#85, following #84).
- 2026-09-21, [ADR 0004](0004-skills-are-linked-never-copied.md): the
  sentence on keeping the links out of git was added to the consequence "The
  bots repo stays small…", in place and without a heading, by the developer for
  #136 (PR #142). A clone had carried links to nothing.
- 2026-09-24, this record: nothing decided changes. The #136 sentence moves
  into the Decision, where it belongs, and keeps its attribution; the record is
  written again in the format the kit now uses and replaces ADR 0004 (#262).
