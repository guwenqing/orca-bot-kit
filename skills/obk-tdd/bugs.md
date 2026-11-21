# Bugs

The detail of "Bugs" in the obk-tdd skill, for when the change fixes a bug. The first
rule is in the skill: a test that reproduces the bug, before the fix, at the seam where it
happens.

Minimise the reproduction until reducing it further would not improve the
diagnosis or the regression check, and keep the evidence you stopped on. Turn it
into a failing test, watch it fail, fix the cause, watch it pass, then run the
original unminimised scenario again.

Two tests are often better than one here: one at the interface, saying what a
caller should have got, and the smallest one that shows the fault where it
lives. Get both to pass. The first is what stops the bug coming back in a way
anyone would notice; the second says where it was.

A regression test written after the fix has proved nothing yet. Prove it in a
disposable copy (a git worktree or a copy of the folder), never by reverting or
stashing in the shared working tree: take the fix out there, confirm with a diff
that it is out, and watch the test fail; then watch it pass with the fix. A
revert that did not land reads as a test that catches nothing. A test that
already failed on a named pre-fix baseline and passes with the fix, unchanged in
between, has its proof: keep that receipt instead of proving it again. Where the
test changed since, or its sensitivity is unproven, prove it again on the bad
baseline in the same way.

When the bug is intermittent, make the test deterministic if you can, and say
which signal you pinned down. When it is one of a class, land the test for the
one in front of you first, then say what else has the same shape.

When a failing test really is impractical, say so out loud, say why, and name
the closest executable check you used instead. Naming a check you will run later
is not having run one. Quiet omission is the part that does damage: a reviewer
treats a missing red receipt as a finding.
