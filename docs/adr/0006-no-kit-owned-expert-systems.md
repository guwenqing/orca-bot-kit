# ADR 0006: No kit-owned expert systems; only standard and famous tools

Date: 2026-09-19. Status: the Decision is the owner's unless a sentence is marked (proposed).

## Context

Several ideas needed a script to judge something: a guard that detects weakened tests, a usage and price calculator, a mutation runner. The owner does not want to maintain an expert system — a growing list of patterns and special cases per language or vendor.

## Decision

What the kit owns must be maintainable in principle: plumbing over a few stable ideas (files, links, YAML, the book, calls to Orca, compiling `AGENTS.md`). Anything that needs judgment is written into skills and done by the agent. An existing tool may be relied on only if it is standard and famous (git, `gh`, Orca, the harnesses, a language's well-known mutation tool). Tools that are popular but not standard (ccusage, third-party price files) are optional, never dependencies.

## Consequences

- No guard script. "Do not weaken a test" is protected by a rule, by mutation testing, by the reviewer's test checks, and by the separate test author.
- The mutation check is the rule in PRD 7.3: one pass per piece of work, the everyday way a hand check on the logic that changed; the language's standard tool is an audit the owner asks for, never everyday work (amended 2026-09-22; this line first said the reverse).
- Finops reads transcripts and looks prices up live, and says so when a price is unknown.
