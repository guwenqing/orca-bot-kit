# ADR 0016: No kit-owned expert systems; only standard and famous tools

Date: 2026-09-24.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19 and, for the mutation check, on 2026-09-20. Consulted: the coordinator, who proposed the scripts this rules out and worded the rule.
Supersedes: [ADR 0006](0006-no-kit-owned-expert-systems.md).

## Context

Several ideas needed a script to judge something: a guard that detects weakened
tests from the diff, a model check reading the hunks such a guard flagged, a
script to run a mutation tool on the changed files, and usage and price
figures taken from a community tool and third-party price files. A guard like
that is a list of patterns per language and per framework that has to keep
growing. The owner does not want to maintain an expert system: "my worry of a
machenical doinng intelligeng work is to maintain a expwrt system which i sont
want to" (the owner's design session, 2026-09-19, not in the repo).

Some tools do their mechanical part well and are already trusted by everyone
who uses them: git, `gh`, Orca, the harnesses, and each language's well-known
mutation tool (Stryker, mutmut, PIT, cargo-mutants). Others are popular in a
community without being a standard. Prices change and are published by the
providers themselves.

A mutation tool over this repo's suite turned out to be slow, because the
suite is end to end: one run on one source file took 40 minutes before it was
narrowed and 12 after (#79, 2026-09-20), and a run of 194 mutants kept a
developer waiting about 90 minutes.

## Decision

What the kit owns must be maintainable in principle: plumbing over a few
stable ideas (files, links, YAML, the book, calls to Orca, compiling
`AGENTS.md`). Anything that needs judgment is written into skills and done by
the agent. An existing tool may be relied on only if it is standard and famous
(git, `gh`, Orca, the harnesses, a language's well-known mutation tool). Tools
that are popular but not standard (ccusage, third-party price files) are
optional, never dependencies.

## Alternatives considered

- **A guard script that detects weakened tests**, run as a Stop hook in Claude
  Code and a pre-push hook in Codex. Proposed by the coordinator. The owner
  dropped it ("how can a mechnical script does that", "i am not a fan of
  that"): it would be a growing list of patterns per language, which is the
  expert system this record rules out.
- **The guard as a tripwire, plus a model that judges what it flags.**
  Dropped with the guard.
- **A kit script that runs a mutation tool on the changed files.** Not built:
  the kit ships no methodology scripts. The owner accepted a mutation tool only
  "if it is a standard way", which means the language's own well-known tool,
  not a runner of the kit's.
- **ccusage and third-party price files as dependencies.** Not chosen: popular
  in the community, but not standard. The owner agreed that the kit reads
  usage from the harness transcripts and looks prices up live, and that finops
  may use ccusage when the user already has it.
- **The standard mutation tool as the everyday check**, which the owner first
  chose on 2026-09-19 ("you can use a standard tool, and if not setup, guide
  the user to … in worst cae, do it llm way"). Replaced on 2026-09-20: the
  tool "is good as an audit overall I feel, but not as an evrydau work"
  (the owner's design session, 2026-09-20), after runs on this repo took from
  tens of minutes to hours.
- Anthropic's usage-report script as a base for the usage figures was
  suggested; what became of it is not recorded.

## Consequences

- Good: the kit's own code stays small enough to keep correct, and nothing in
  it needs updating per language, framework or vendor.
- Bad: no guard script. "Do not weaken a test" is protected by a rule, by the
  mutation check, by the reviewer's test checks, and by the separate test
  author, and a user who wants a hard gate adds their own hook or CI check.
- The mutation check is the rule in PRD 7.3: one pass per piece of work, the
  everyday way a hand check on the logic that changed; the language's standard
  tool is an audit the owner asks for, never everyday work.
- Finops reads transcripts and looks prices up live, and says so when a price
  is unknown.
- Bad: judgement done by an agent varies from run to run, where a script would
  not. (Proposed in #262; not recorded when it was decided.)
- Revisit if: a standard tool appears for something the kit now leaves to
  judgement, or a piece of kit code starts to grow a list of special cases.
  Confidence: high; the owner stated the rule twice and later rulings apply it
  (#111, #136, #221). (Proposed in #262; not recorded when it was decided.)
- Checked by: a reviewer looking at any kit code that holds patterns, tables or
  price data.

## History

- 2026-09-19, [ADR 0006](0006-no-kit-owned-expert-systems.md): decided by the
  owner in his design session, with the consequence "Mutation testing uses the
  language's standard tool; if it is not set up the agent guides the user; in
  the worst case the agent mutates by hand."
- 2026-09-20: the owner changed the mutation check in the PRD to a hand check
  every day and the tool as an audit (PRD 7.3, #93 to #95). ADR 0006 was not
  changed at the time.
- 2026-09-22, [ADR 0006](0006-no-kit-owned-expert-systems.md): its mutation
  consequence was rewritten in place to match PRD 7.3, with a note that the
  line first said the reverse, by the coordinator (#160) after the #151 review
  found it stale.
- 2026-09-24, this record: nothing decided changes. The mutation consequence
  is the one that holds since 2026-09-20; the record is written again in the
  format the kit now uses and replaces ADR 0006 (#262).
