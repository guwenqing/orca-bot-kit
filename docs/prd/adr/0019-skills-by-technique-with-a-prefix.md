# ADR 0019: Skills are organised by technique and carry the `obk-` prefix

Date: 2026-09-24.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19, and for the prefix `obk-` on 2026-09-20. Consulted: the coordinator, who proposed the shelf by technique, and a research agent on names and namespaces. A sentence marked (proposed) is not decided yet.
Supersedes: [ADR 0009](0009-skills-by-technique-with-a-prefix.md).

## Context

The skill set could be one skill per role (developer, architect, reviewer) or
smaller skills per technique. The owner wanted "SKILLS FOR THE CORE OF THE
ROLES WE NEED, AND THE KEY METHODOLOGY" and not every detail bundled (the
owner's design session, 2026-09-19, not in the repo). A bot's role is already
defined in its charter and `AGENTS.md`.

In Claude Code a user skill with the same name as a built-in command silently
replaces it (`debug`, `design`, `review`, `simplify`, `run`, `verify`, `loop`).
The Agent Skills spec allows only lowercase letters, digits and hyphens in a
name, and the name must match the folder; colon or slash prefixes fail to load
in some hosts, and the `plugin:skill` form is for real plugins only (all from
the documentation, 2026-09-19; tech notes).

## Decision

Skills are per technique (`obk-tdd`, `obk-debugging`, `obk-arch`,
`obk-reviewing`, `obk-grilling`, `obk-personal-facilitation`, utilities,
management skills). A role is a charter plus a choice of skills; Bot Father
recommends and provides the skills for each role the user creates. Every kit
skill is named `obk-<name>`, and the folder, the `name` field and the symlink
are identical. A skill does not rely on another skill being loaded; what it
needs, it carries (proposed).

## Alternatives considered

- **One skill per role** (`developer`, `architect`, `reviewer`). The
  coordinator's first proposal. Not chosen: a role skill would say again what
  the charter already says, and a technique can be shared between roles, as
  when a developer debugs and a reviewer reads tests. The owner: "by technique,
  but we recommend and suggest provide the skills for the roles user creates."
- **Bare names with no prefix** (`tdd`, `debugging`, `reviewing`). Not
  chosen: a bare name can clash with a built-in command, and `debug`,
  `design` and `review` already do.
- **A colon or slash namespace** (`kit:tdd`, `kit/tdd`). Not chosen: not
  allowed by the spec, and it fails to load in some hosts.
- **A plugin namespace** (`/kit:tdd`). Not chosen: it exists only for real
  plugins, and the kit is not one.
- **A prefix on the link alone**, with the folder and `name` left bare. Not
  chosen: the name must match the folder.
- **Other hyphen prefixes.** The coordinator offered several (among them
  `pod-` and `baba-`) when the owner asked for a nicer name; the owner chose
  "kit", then `bk-`, and on 2026-09-20 `obk-`, after the command had become
  `obk` (#55). The reason for the last change is not recorded beyond "I
  changed my idea, chagne the skill prefix to obk as well".

## Consequences

- Good: no clash with built-in commands in either harness, and kit skills are
  recognisable at a glance.
- Bad: some text is repeated across skills (for example the shapes of bad
  tests appear in both `obk-tdd` and `obk-reviewing`).
- The role-to-skills table lives in the management skill.
- Revisit if: the kit is packaged as a plugin, or a harness gives skills a
  namespace of their own. Confidence: high for the prefix, which follows from
  the spec and the built-in names. (Proposed in #262; not recorded when it was
  decided.)
- Checked by: `test/kit-skills.test.js`, which checks that each kit skill's
  name is its folder's, carries the prefix and is not a built-in's.

## History

- 2026-09-19, [ADR 0009](0009-skills-by-technique-with-a-prefix.md): decided
  by the owner in his design session, with the prefix `bk-`.
- 2026-09-20, [ADR 0009](0009-skills-by-technique-with-a-prefix.md): the
  prefix became `obk-` in the title, the decision and the consequences, when
  the owner changed his mind (#70). The shape of the decision did not change.
- 2026-09-24, this record: nothing decided changes. It is written again in the
  format the kit now uses, with its alternatives, and replaces ADR 0009 (#262).
