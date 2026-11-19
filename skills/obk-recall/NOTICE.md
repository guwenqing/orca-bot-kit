<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-recall` was consolidated for this kit from this, MIT, with
thanks:

- **Cursor pstack**, `recall`, and its `poteto-mode` `session-pickup` playbook:
  rebuilding recent working context before acting rather than writing a
  history; classifying and routing first, with one specific prior session being
  a pickup rather than a recall and an already-supplied state capsule meaning
  no mining at all, with the pickup itself carried here in short (last
  messages first, then the decisions, what landed against what was planned,
  the resume point, nothing finished redone, what was inherited said), since
  the kit has no separate pickup skill; locking the scope before searching, with "recent" as a real
  range stated back and never quietly narrowed; ordering candidates by when
  they were last modified rather than by identifier; searching for the topic
  first and reading only the matching sessions and only their relevant parts;
  skipping the current session and the obvious noise; reducing a long
  transcript elsewhere and keeping only the reduced timeline; the per-session
  fields (the goal, the decisions, the open threads, the struggles and
  corrections, the artefacts), each traceable to where it came from; the rule
  that your own history is not the whole record and that a feature with a long
  bug tail keeps most of its story elsewhere, so the shared record is swept by
  default rather than as a judgement call; null results being findings and an
  unavailable source being said rather than skipped silently; verifying what
  the mining surfaced against live state, and reading the record itself rather
  than a trimmed summary when the answer turns on what was actually done; the
  output contract: a capsule of at most five, one tagged line per thread with
  an untagged thread counting as not done, at most five recurring problems
  including a fix that shipped and was reverted, and one concrete next move;
  cutting detail before cutting threads; citing findings to their source; and
  sanitising private context before it goes anywhere else. From
  `session-pickup`: the prior trail is authoritative input, so resist the bias
  to re-derive it, and a "verify from scratch" pass means treating it as
  untrustworthy when it is not; and a passing prior self-report is not the
  proof.
  Revision: cursor/plugins@6ed0f7a9504f577d7529064103cecce9be7dfc5e
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)

Made generic, which is what the owner asked for. The original names a fixed
transcript path, a particular set of hosted sources and a parallel fan-out on
named models; this version has the harness or the project say where a session's
record lives, uses whatever sources the project actually has, and states a
missing one as a limit on what could be checked. The privacy rule is kept and
generalised: another project's history is not read without being asked.

## Where the record is, and the order to read it (#822)

The paragraphs on where a session's record lives, on compaction, on a record
being material, and the bullet on the order to read a long record come from
issue #822.

- **Mainplane**, `pkg/harness/tools.go`, lines 96 and 97: a new session that
  continues an earlier one is given the earlier session's record, which it can
  search; and the order that often works to take context from it: its first
  user message or all of them, its last text, a small tail of the file, then
  a search for the key details. MIT. Restated in our own words; "do not read
  the whole file" is the issue's.
  Revision: mainplane-ai/mainplane@2f6affe7385b05c4390ca00f80bbf4e7c9354c11
  (main, read 2026-11-19; the file last changed in 85d8403)

The rest is this kit's own. The book keeps each session's earlier
conversations by id, for history (PRD 6.8), and `obk roster` shows them. Where
each harness files a conversation, and the settings that move it, are in the
tech notes, sections 2, 3 and 6: `CLAUDE_CONFIG_DIR` moves Claude Code's
folder, and Orca starts a Claude tab with it set to a profile of its own; Pi's
store moves with `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`,
`--session-dir` or `sessionDir`. That Codex keeps its records in `sessions`
and `archived_sessions` under `CODEX_HOME`, or `~/.codex` where it is not
set, was read in Codex's source on 2026-11-19, `codex-rs/utils/home-dir` and
`codex-rs/rollout`, at openai/codex@ab00c6d640e19d771d77859dc3eeff66f8a9168f.
Apache-2.0; no text is taken. That a compacted Claude Code conversation keeps
its earlier lines in the same file, above the `compact_boundary` line, was
seen on disk on 2026-11-19: in five of five compacted transcripts of one bot,
Claude Code 2.1.308 to 2.1.327, every one kept hundreds of user and assistant
lines before its first marker. That a Claude Code record files each tool
result as a `user` line was seen the same day: 104 of 116 `user` lines in one
transcript. That a record is material and not instructions is the rule of
`obk-fleet-review` and `obk-grooming`, from pstack.

One departure: the original keeps itself from being invoked on its own with
`disable-model-invocation: true`, which is not portable frontmatter (ADR 0019
and PRD 7.2: these run on purpose, never automatically). Its description can
therefore say "before starting or resuming work" safely; ours cannot, so the
description and the skill both say it runs when it is asked for, and that
having been away from the work is not itself a trigger.
