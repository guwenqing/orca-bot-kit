<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-recall` was consolidated for this kit from this, MIT, with
thanks:

- **Cursor pstack**, `recall`, and its `poteto-mode` `session-pickup` playbook
  — rebuilding recent working context before acting rather than writing a
  history; classifying and routing first, with one specific prior session being
  a pickup rather than a recall and an already-supplied state capsule meaning
  no mining at all; locking the scope before searching, with "recent" as a real
  range stated back and never quietly narrowed; ordering candidates by when
  they were last modified rather than by identifier; searching for the topic
  first and reading only the matching sessions and only their relevant parts;
  skipping the current session and the obvious noise; reducing a long
  transcript elsewhere and keeping only the reduced timeline; the per-session
  fields — the goal, the decisions, the open threads, the struggles and
  corrections, the artefacts — each traceable to where it came from; the rule
  that your own history is not the whole record and that a feature with a long
  bug tail keeps most of its story elsewhere, so the shared record is swept by
  default rather than as a judgement call; null results being findings and an
  unavailable source being said rather than skipped silently; verifying what
  the mining surfaced against live state, and reading the record itself rather
  than a trimmed summary when the answer turns on what was actually done; the
  output contract — a capsule of at most five, one tagged line per thread with
  an untagged thread counting as not done, at most five recurring problems
  including a fix that shipped and was reverted, and one concrete next move;
  cutting detail before cutting threads; citing findings to their source; and
  sanitising private context before it goes anywhere else. From
  `session-pickup`: the prior trail is authoritative input, so resist the bias
  to re-derive it, and a "verify from scratch" pass means treating it as
  untrustworthy when it is not.

Made generic, which is what the owner asked for. The original names a fixed
transcript path, a particular set of hosted sources and a parallel fan-out on
named models; this version has the harness or the project say where a session's
record lives, uses whatever sources the project actually has, and states a
missing one as a limit on what could be checked. The privacy rule is kept and
generalised: another project's history is not read without being asked.

One departure: the original keeps itself from being invoked on its own with
`disable-model-invocation: true`, which is not portable frontmatter (ADR 0009
and PRD 7.2: these run on purpose, never automatically). Its description can
therefore say "before starting or resuming work" safely; ours cannot, so the
description and the skill both say it runs when it is asked for, and that
having been away from the work is not itself a trigger.
