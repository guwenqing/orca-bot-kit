# Working rules for this repo

## What decides

`docs/prd.md` is the design, `docs/adr/` the lasting decisions, `docs/tech-notes.md`
what we know about Orca and the two harnesses. Issues state intent and boundary and
point at these; how to build is yours. A `[proposed]` item in the PRD is not confirmed
by the owner; a fact marked unverified in the tech notes is proven live before code
relies on it.

## The owner's decisions on how code is made

Test first, one vertical slice at a time. The test author is a separate agent, and
the implementer never changes a test to make it pass. The reviewer is a separate
agent and only comments. The mutation check follows PRD 7.3. Use what the standard
library or the platform already does. Take no requirement stricter than the intent.

## Safety on the owner's machine

He works in this same Orca. Touch only what you create, clean it up, and never close
or type into a tab that is not yours. Never kill a process you did not start, and
never `kill -1` or an id derived from `ps` (on 2026-09-20 that killed every process
of his account). Start no background process without guaranteed cleanup.

## Authorisation and roles

Standing authorisation from the owner: commit, push, open the PR, and after the review
merge and close the issue; do not wait for him and do not ask him about routine steps.
Ask the reviewer directly (its Orca tab is titled "reviewer"); it answers on the PR and
in your tab. The coordinator hands out issues, answers questions, and steps in only for
something out of the ordinary; take its answers as the owner's. Go to the owner only
for what is irreversible outside this repo, touches his accounts or other people, or
changes what the product does beyond the PRD.
