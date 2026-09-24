# ADR 0004: Skills are linked, never copied; online sources are cloned beside the bots repo

Date: 2026-09-19. Status: superseded by [ADR 0014](0014-skills-are-linked-never-copied.md). Until then, the Decision was the owner's unless a sentence is marked (proposed).

## Context

The bots folder is the user's own git repo. The kit is installed with npm and will be updated. Users also want skills from their own folders, from online repos at a chosen version, or from anywhere on disk.

## Decision

Kit skills are symlinked from the installed package into each bot's `.claude/skills` and `.agents/skills`. Online sources (repo, subfolder, ref) are cloned into a folder beside the bots repo, never inside it, with the resolved sha recorded. Skills placed by hand are left alone. The kit copies a skill into the bots repo only when the user asks.

## Consequences

- Updating the kit updates every bot's kit skills at once.
- The bots repo stays small and holds only the user's own content. The links themselves are part of what the kit
  makes on a machine rather than part of the repo, so `init` seeds a `.gitignore` that keeps them and the kit's
  record of them out of git; a clone gets its links from `obk up`, and carries none that point nowhere.
  (Decided in issue #136 by the developer, inside that issue's boundary; the owner may overrule.)
- Links break if the package moves; the kit's health check reports broken links.
- The user takes the risk for third-party skills; the kit only prints a one-line warning when a source has scripts or hooks.
