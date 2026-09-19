# ADR 0009: Skills are organised by technique and carry the `bk-` prefix

Date: 2026-09-19. Status: the Decision is the owner's unless a sentence is marked (proposed).

## Context

The skill set could be one skill per role (developer, architect, reviewer) or smaller skills per technique. In Claude Code a user skill with the same name as a built-in command silently replaces it (`debug`, `design`, `review`, `simplify`, `run`, `verify`, `loop`). The Agent Skills spec allows only lowercase letters, digits and hyphens in a name, and the name must match the folder; colon or slash prefixes fail to load in some hosts.

## Decision

Skills are per technique (`bk-tdd`, `bk-debugging`, `bk-arch`, `bk-reviewing`, `bk-grilling`, `bk-personal-facilitation`, utilities, management skills). A role is a charter plus a choice of skills; Bot Father recommends and provides the skills for each role the user creates. Every kit skill is named `bk-<name>`, and the folder, the `name` field and the symlink are identical. A skill does not rely on another skill being loaded; what it needs, it carries (proposed).

## Consequences

- No clash with built-in commands in either harness, and kit skills are recognisable at a glance.
- Some text is repeated across skills (for example the shapes of bad tests appear in both `bk-tdd` and `bk-reviewing`).
- The role-to-skills table lives in the management skill.
