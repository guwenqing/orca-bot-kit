# ADR 0007: The test author and the reviewer are always separate from the implementer

Date: 2026-09-19. Status: superseded by [ADR 0017](0017-test-author-and-reviewer-are-always-separate.md). Until then, the Decision was the owner's unless a sentence is marked (proposed).

## Context

An agent that writes both the code and the tests shares its blind spots, tends to write tests it knows will pass, and tends to weaken a test to get green. An agent reviewing its own work finds little.

## Decision

For code-writing bots the test author is always a different agent from the implementer, and so is the reviewer. A subagent with a fresh context counts; another session or bot also counts, by the user's flavour. The author gets the requirement and the public interfaces, not the implementer's code plan. The implementer cannot change a test to make it pass; a test that looks wrong is reported to the author (proposed). The author's tests are validated by mutation testing. The reviewer never modifies code; it only comments, the implementer makes the change, and the change is verified again. When a substantial change means the old tests cannot hold, the author redoes them, usually deleting the old tests first.

## Consequences

- Every behaviour change costs at least one extra agent run.
- In Claude Code the helper must be a fresh subagent, not a fork that inherits the conversation; Codex spawns a subagent only when asked explicitly, so the skill asks.
- A reviewer on a different harness is a bonus the kit makes easy, not a requirement.
